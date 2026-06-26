import { sanitizeError } from "@/lib/sanitizeError";
import { getDownloadStatus } from "@/lib/tunnel/downloadState";
import { getTailscaleStatus, getTunnelStatus } from "@/lib/tunnel/tunnelManager";
import { releaseSSESlot, tryAcquireSSESlot } from "../../../monitoring/_sseConnectionCap";
export const dynamic = "force-dynamic";

const ROUTE_PATH = "/api/tunnel/status/stream";
const POLL_MS = 3000;
const HEARTBEAT_MS = 25000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

async function buildStatusPayload() {
  const [tunnel, tailscale] = await Promise.all([getTunnelStatus(), getTailscaleStatus()]);
  const download = getDownloadStatus();
  return { tunnel, tailscale, download };
}

/**
 * GET /api/tunnel/status/stream
 * SSE stream for tunnel/tailscale status updates.
 */
export async function GET(request: any) {
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
    if (idleTimeout) clearTimeout(idleTimeout);
    if (poll) clearInterval(poll);
    if (heartbeat) clearInterval(heartbeat);
    releaseSSESlot(ROUTE_PATH);
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {}
      };

      const sendSnapshot = async (force = false) => {
        if (closed) return;
        try {
          const payload = await buildStatusPayload();
          const sig = JSON.stringify(payload);
          if (force || sig !== lastSig) {
            lastSig = sig;
            send(payload);
          }
        } catch (error) {
          send({ error: sanitizeError(error) || "Failed to read tunnel status" });
        }
      };

      // Initial snapshot
      await sendSnapshot(true);

      poll = setInterval(() => {
        sendSnapshot(false).catch(() => {});
      }, POLL_MS);

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {}
      }, HEARTBEAT_MS);

      idleTimeout = setTimeout(() => cleanup(), IDLE_TIMEOUT_MS);

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
