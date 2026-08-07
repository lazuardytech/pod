import { getRecentLogsStructured } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage/request-logs/stream
 * SSE stream that pushes request log updates as they arrive.
 * Detects: new entries (maxId change) AND status changes (PENDING → SUCCESS/FAILED).
 */
export async function GET(request: Request) {
  let closed = false;
  let lastSig = "";

  const encoder = new TextEncoder();

  // Signature includes maxId + all PENDING row IDs + status hash
  // so any status change (PENDING→SUCCESS/FAILED) triggers an update
  function buildSig(logs: Array<{ id?: string; status?: string | string[] }> = []) {
    const maxId = logs.length > 0 ? logs[0]?.id : 0;
    const pendingIds = logs
      .filter((l) => l.status?.includes("PENDING"))
      .map((l) => l.id)
      .join(",");
    // Hash recent statuses to catch any status change
    const statusHash = logs
      .slice(0, 50)
      .map((l) => `${l.id}:${l.status}`)
      .join("|");
    return `${maxId}|${pendingIds}|${statusHash}`;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      // Initial snapshot
      try {
        const logs = await getRecentLogsStructured(300);
        lastSig = buildSig(logs as unknown as Array<{ id?: string; status?: string }>);
        send({ type: "init", logs });
      } catch {
        send({ type: "init", logs: [] });
      }

      // Fixed 2s poll — 1s fast-poll for PENDING entries caused unnecessary CPU load
      const POLL_MS = 2000;
      const poll = async () => {
        if (closed) return;
        try {
          const logs = await getRecentLogsStructured(300);
          const sig = buildSig(logs as unknown as Array<{ id?: string; status?: string }>);
          if (sig !== lastSig) {
            lastSig = sig;
            send({ type: "update", logs });
          }
        } catch {}
        if (!closed) setTimeout(poll, POLL_MS);
      };

      setTimeout(poll, POLL_MS);

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {}
      }, 30000);

      let idleTimeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        closed = true;
        clearTimeout(idleTimeout ?? undefined);
        clearInterval(heartbeat);
      };

      // Idle timeout — close connection if inactive for 5 minutes
      idleTimeout = setTimeout(
        () => {
          cleanup();
        },
        5 * 60 * 1000,
      );

      // Fires reliably on client disconnect in Next.js standalone + Bun
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
