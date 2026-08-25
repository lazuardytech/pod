import { sanitizeError } from "@/lib/sanitizeError";
import { releaseSSESlot, tryAcquireSSESlot } from "../../../monitoring/_sseConnectionCap";
import { getModelAvailabilityPayload } from "../_availability";
import { checkDashboardApiAuth } from "@/lib/routeAuth";
export const dynamic = "force-dynamic";

const ROUTE_PATH = "/api/models/availability/stream";
const POLL_MS = 10000;
const HEARTBEAT_MS = 25000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * GET /api/models/availability/stream
 * SSE stream for model lock/unavailable status.
 */
export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  const slot = tryAcquireSSESlot(ROUTE_PATH);
  if (!slot.allowed) return slot.response;

  let closed = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSig = "";
  const encoder = new TextEncoder();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (poll) clearInterval(poll);
    if (heartbeat) clearInterval(heartbeat);
    if (idleTimeout) clearTimeout(idleTimeout);
    releaseSSESlot(ROUTE_PATH);
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {}
      };

      const pushSnapshot = async (force = false) => {
        if (closed) return;
        try {
          const payload = await getModelAvailabilityPayload();
          const sig = JSON.stringify(payload);
          if (force || sig !== lastSig) {
            lastSig = sig;
            send(payload);
          }
        } catch (error) {
          send({ error: sanitizeError(error) || "Failed to load model availability" });
        }
      };

      await pushSnapshot(true);

      poll = setInterval(() => {
        pushSnapshot(false).catch(() => {});
      }, POLL_MS);

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {}
      }, HEARTBEAT_MS);

      idleTimeout = setTimeout(() => {
        cleanup();
      }, IDLE_TIMEOUT_MS);

      request.signal.addEventListener(
        "abort",
        () => {
          cleanup();
        },
        { once: true },
      );
      return cleanup;
    },
    cancel() {
      cleanup();
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
