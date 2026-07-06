import net from "node:net";
import { HEALTH_CHECK, INTERNET_CHECK } from "./tunnelConfig.ts";

export function checkInternet(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    socket.setTimeout(INTERNET_CHECK.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try {
      socket.connect(INTERNET_CHECK.port, INTERNET_CHECK.host);
    } catch {
      finish(false);
    }
  });
}

// Single health probe: direct fetch (no DNS pre-check — trycloudflare.com
// subdomains are ephemeral and not in public DNS, so resolve4() always fails
// for them even when the tunnel is perfectly functional).
export async function probeUrlAlive(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface CancelToken {
  cancelled: boolean;
}

// Poll until tunnel responds /api/health, or timeout. Cancellable via token.
export async function waitForHealth(
  url: string,
  cancelToken: CancelToken = { cancelled: false },
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    if (await probeUrlAlive(url)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}
