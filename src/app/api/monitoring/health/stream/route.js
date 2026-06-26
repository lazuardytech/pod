import { checkMonitoringAuth } from "../_auth.js";
import { buildHealthPayload } from "../_health.js";
import { releaseSSESlot, tryAcquireSSESlot } from "../../_sseConnectionCap.js";

import { sanitizeError } from "@/lib/sanitizeError";
export const dynamic = "force-dynamic";

const ROUTE_PATH = "/api/monitoring/health/stream";

/**
 * GET /api/monitoring/health/stream
 * SSE stream — pushes full health snapshot every 10s.
 * Auth (see ../_auth.js): API key (Bearer / x-api-key) OR dashboard JWT cookie.
 * Max concurrent connections: 100 (enforced by _sseConnectionCap.js).
 */
export async function GET(request) {
  const unauthorized = await checkMonitoringAuth(request);
  if (unauthorized) return unauthorized;

  // Enforce SSE connection cap
  const slot = tryAcquireSSESlot(ROUTE_PATH);
  if (!slot.allowed) return slot.response;

  let closed = false;
  const encoder = new TextEncoder();
  const INTERVAL_MS = 10000;
  const HEARTBEAT_MS = 25000;

  const releaseSlot = () => {
    if (!closed) {
      closed = true;
      releaseSSESlot(ROUTE_PATH);
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      // Initial snapshot immediately
      try {
        send(await buildHealthPayload());
      } catch (err) {
        send({ error: sanitizeError(err) });
      }

      // Poll every 10s
      const poll = async () => {
        if (closed) return;
        try {
          send(await buildHealthPayload());
        } catch {}
        if (!closed) setTimeout(poll, INTERVAL_MS);
      };
      setTimeout(poll, INTERVAL_MS);

      // Keepalive heartbeat every 25s
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {}
      }, HEARTBEAT_MS);

      let idleTimeout;

      const cleanup = () => {
        clearTimeout(idleTimeout);
        releaseSlot();
        clearInterval(heartbeat);
      };

      // Idle timeout — close connection if inactive for 5 minutes
      idleTimeout = setTimeout(
        () => {
          cleanup();
        },
        5 * 60 * 1000,
      );

      request.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(idleTimeout);
          cleanup();
        },
        { once: true },
      );
      return cleanup;
    },
    cancel() {
      releaseSlot();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
