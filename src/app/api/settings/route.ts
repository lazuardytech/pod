import bcrypt from "bcryptjs";
import { asString } from "@/app/api/_types";
import { NextResponse } from "next/server";
import { resetComboRotation } from "open-sse/services/combo.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

import { sanitizeError } from "@/lib/sanitizeError";
import { parseJsonBody } from "@/lib/parseJsonBody";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, ...safeSettings } = settings;

    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    const hasCustomInitialPassword = !!process.env.INITIAL_PASSWORD;

    // Show default password hint only when:
    // - no password has been set yet (using hardcoded default "123456")
    // - AND INITIAL_PASSWORD env is not set (custom password via env)
    const isDefaultPassword = !password && !hasCustomInitialPassword;

    const runtime = typeof Bun !== "undefined" ? `Bun ${Bun.version}` : `Node.js ${process.version}`;
    const platform = `${process.platform} ${process.arch}`;

    return NextResponse.json(
      {
        ...safeSettings,
        enableRequestLogs,
        enableTranslator,
        hasPassword: !!password,
        isDefaultPassword,
        systemInfo: { runtime, platform },
      },
      { headers: SETTINGS_RESPONSE_HEADERS },
    );
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password as string | undefined;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(asString(body.currentPassword), currentHash as string);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(asString(body.newPassword), salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.hasOwn(body, "outboundProxyEnabled") ||
      Object.hasOwn(body, "outboundProxyUrl") ||
      Object.hasOwn(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.hasOwn(body, "comboStrategy") ||
      Object.hasOwn(body, "comboStickyRoundRobinLimit") ||
      Object.hasOwn(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    const { password, ...safeSettings } = settings;
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
