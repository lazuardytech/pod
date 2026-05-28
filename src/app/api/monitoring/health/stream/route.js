import { checkMonitoringAuth } from "../_auth.js";
import { buildHealthPayload } from "../_health.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring/health/stream
 * SSE stream — pushes full health snapshot every 10s.
 * Auth (see ../_auth.js): API key (Bearer / x-api-key) OR dashboard JWT cookie.
 */
export async function GET(request) {
  const unauthorized = await checkMonitoringAuth(request);
  if (unauthorized) return unauthorized;

  let closed = false;
  const encoder = new TextEncoder();
  const INTERVAL_MS = 10000;
  const HEARTBEAT_MS = 25000;

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
        send({ error: err.message });
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

      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
      return cleanup;
    },
    cancel() {
      closed = true;
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
