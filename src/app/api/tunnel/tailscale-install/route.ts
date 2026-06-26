"use server";

import { execSync } from "node:child_process";
import os from "node:os";

import { parseJsonBody } from "@/lib/parseJsonBody";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";
import { error as logError } from "@/sse/utils/logger";
// Removed initDbHooks call

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ""}`;

function hasBrew() {
  try {
    execSync("which brew", { stdio: "ignore", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH } });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request) {
  const authResponse = await checkStrictDashboardAuth(request);
  if (authResponse) return authResponse;

  const [json, parseErr] = await parseJsonBody(request);
  if (parseErr) return parseErr;

  const [{ generateShortId, loadState }, { installTailscale }] = await Promise.all([
    import("@/lib/tunnel/state.js"),
    import("@/lib/tunnel/tailscale.js"),
  ]);
  const platform = os.platform();
  const isWindows = platform === "win32";
  const isBrew = platform === "darwin" && hasBrew();
  const needsPassword = !isWindows && !isBrew;

  const sudoPassword = json?.sudoPassword || "";

  if (needsPassword && !sudoPassword.trim()) {
    return new Response(JSON.stringify({ error: "Sudo password is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const shortId = loadState()?.shortId || generateShortId();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await installTailscale(sudoPassword, shortId, (msg) => {
          send("progress", { message: msg });
        });
        send("done", { success: true, authUrl: result?.authUrl || null });
      } catch (error) {
        logError("TailscaleInstall", "Tailscale install error", { error: error?.message || error });
        const msg =
          sanitizeError(error)?.includes("incorrect password") || sanitizeError(error)?.includes("Sorry")
            ? "Wrong sudo password"
            : sanitizeError(error);
        send("error", { error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
