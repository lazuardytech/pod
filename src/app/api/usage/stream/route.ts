import { getActiveRequests, getUsageStats, statsEmitter } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const encoder = new TextEncoder();
  const state: {
    closed: boolean;
    keepalive: ReturnType<typeof setInterval> | null;
    send: (() => void) | null;
    sendPending: (() => Promise<void>) | null;
    cachedStats: Record<string, unknown> | null;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    idleTimeout: ReturnType<typeof setTimeout> | null;
  } = {
    closed: false,
    keepalive: null,
    send: null,
    sendPending: null,
    cachedStats: null,
    debounceTimer: null,
    idleTimeout: null,
  };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    clearTimeout(state.idleTimeout ?? undefined);
    if (state.send) statsEmitter.off("update", state.send);
    if (state.sendPending) statsEmitter.off("pending", state.sendPending);
    if (state.keepalive) clearInterval(state.keepalive);
    if (state.debounceTimer) clearTimeout(state.debounceTimer ?? undefined);
  };

  // Idle timeout — close connection if inactive for 5 minutes
  state.idleTimeout = setTimeout(
    () => {
      cleanup();
    },
    5 * 60 * 1000,
  );

  request.signal.addEventListener("abort", () => {
    clearTimeout(state.idleTimeout ?? undefined);
    cleanup();
  });

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) — debounced to max once per 2s
      const doFullRefresh = async () => {
        if (state.closed) return;
        try {
          const stats = await getUsageStats();
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          cleanup();
        }
      };

      state.send = () => {
        if (state.closed) return;
        // Push lightweight update immediately from cache
        if (state.cachedStats) {
          getActiveRequests()
            .then(({ activeRequests, recentRequests, errorProvider }) => {
              if (state.closed) return;
              const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
            })
            .catch(() => {});
        }
        // Debounce full recalc to max once per 2s
        if (state.debounceTimer) return;
        state.debounceTimer = setTimeout(() => {
          state.debounceTimer = null;
          doFullRefresh();
        }, 2000);
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          cleanup();
        }
      };

      await doFullRefresh();

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive!);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
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
