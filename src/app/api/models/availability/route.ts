import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import {
  getProviderConnections,
  getSettings,
  type Settings,
  updateProviderConnection,
} from "@/lib/localDb";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateFetchUrl } from "@/lib/validateUrl";
import { getModelAvailabilityPayload, MODEL_LOCK_PREFIX } from "./_availability";
import { checkDashboardApiAuth } from "@/lib/routeAuth";

export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const payload = await getModelAvailabilityPayload();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[API] Failed to get model availability:", error);
    return NextResponse.json({ error: "Failed to fetch model availability" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { action, provider, model } = body ?? ({} as Record<string, unknown>);
    const providerStr = asString(provider);
    const modelStr = asString(model);

    if (!providerStr || !modelStr) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Simple unconditional clear (legacy)
    if (action === "clearCooldown") {
      const connections = await getProviderConnections({ provider: providerStr });
      const lockKey = `${MODEL_LOCK_PREFIX}${modelStr}`;
      await Promise.all(
        connections
          .filter((connection) => connection[lockKey])
          .map((connection) =>
            updateProviderConnection(connection.id, {
              [lockKey]: null,
              ...(connection.testStatus === "unavailable"
                ? { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 }
                : {}),
            }),
          ),
      );
      return NextResponse.json({ ok: true });
    }

    // Test first, then clear only if passing — re-lock with minimum lockout if still failing
    if (action === "recheckAndClear") {
      const envBase = process.env.BASE_URL;
      // Validate BASE_URL env var if set; fall back to localhost using PORT env
      // (or default 20128). Hostname and port are NOT derived from request.url
      // to eliminate Host-header SSRF.
      const baseUrl = (() => {
        if (envBase) {
          const check = validateFetchUrl(envBase, { allowPrivate: true });
          if (check.ok) return envBase.replace(/\/$/, "");
        }
        const port = Number.parseInt(process.env.PORT || "20128", 10);
        const safePort = Number.isFinite(port) && port > 0 && port < 65536 ? port : 20128;
        return `http://localhost:${safePort}`;
      })();

      // Get an active internal API key for auth
      let apiKey: string | null = null;
      try {
        const { getApiKeys } = await import("@/lib/localDb");
        const keys = await getApiKeys();
        apiKey = keys.find((k) => k.isActive !== false)?.key || null;
      } catch {}

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-pod-no-cache": "true",
      };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      // Test the model
      // baseUrl is derived from the request host (internal loopback) or BASE_URL env var,
      // both validated above with allowPrivate:true — not a user-supplied value.
      // lgtm[js/request-forgery]
      let testOk = false;
      try {
        const testModel = modelStr === "__all" ? null : modelStr;
        if (testModel) {
          const res = await fetch(`${baseUrl}/api/models/test`, {
            // lgtm[js/request-forgery]
            method: "POST",
            headers,
            body: JSON.stringify({ model: `${providerStr}/${testModel}` }),
            signal: AbortSignal.timeout(15000),
          });
          const data = await res.json().catch(() => ({}));
          testOk = !!data?.ok;
        }
      } catch {}

      const connections = await getProviderConnections({ provider: providerStr });
      const lockKey = `${MODEL_LOCK_PREFIX}${modelStr}`;
      const settings = await getSettings().catch(() => ({}) as Settings);
      const minimumLockoutMinutes = Number(settings.minimumLockoutMinutes) || 0;

      if (testOk) {
        // Test passed — clear the lock
        await Promise.all(
          connections
            .filter((c) => c[lockKey])
            .map((c) =>
              updateProviderConnection(c.id, {
                [lockKey]: null,
                ...(c.testStatus === "unavailable"
                  ? { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 }
                  : {}),
              }),
            ),
        );
        return NextResponse.json({ ok: true, tested: true, passed: true });
      }

      // Test failed — re-apply minimum lockout if configured, otherwise keep existing lock.
      // Apply the same backoff multiplier as markAccountUnavailable: 1x, 2x, 3x per backoffLevel.
      if (minimumLockoutMinutes > 0) {
        const minimumLockoutMs = minimumLockoutMinutes * 60 * 1000;
        await Promise.all(
          connections
            .filter((c) => c[lockKey])
            .map((c) => {
              const backoffMultiplier = Math.max(1, Number(c.backoffLevel) || 1);
              const effectiveMs = minimumLockoutMs * backoffMultiplier;
              const lockUntil = new Date(Date.now() + effectiveMs).toISOString();
              return updateProviderConnection(c.id, { [lockKey]: lockUntil });
            }),
        );
      }
      return NextResponse.json({ ok: false, tested: true, passed: false });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    return NextResponse.json({ error: "Failed to clear cooldown" }, { status: 500 });
  }
}
