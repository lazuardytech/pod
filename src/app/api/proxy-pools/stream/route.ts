import { getProxyPools } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/proxy-pools/stream
 * SSE stream that pushes proxy pool updates every 3s.
 */
export async function GET(request: Request) {
  let closed = false;
  let lastSig = "";

  const encoder = new TextEncoder();

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
        const pools = await getProxyPools();
        lastSig = JSON.stringify(pools.map((p) => `${p.id}:${p.isActive}:${p.updatedAt ?? ""}`));
        send({ type: "init", pools });
      } catch {
        send({ type: "init", pools: [] });
      }

      // Poll for changes every 3s
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }
        try {
          const pools = await getProxyPools();
          const sig = JSON.stringify(
            pools.map((p) => `${p.id}:${p.isActive}:${p.updatedAt ?? ""}`),
          );
          if (sig !== lastSig) {
            lastSig = sig;
            send({ type: "update", pools });
          }
        } catch {}
      }, 3000);

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
        clearInterval(interval);
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
