"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/shared/components/Button";
import LucideIcon from "@/shared/components/LucideIcon";
import {
  drainOfflineMutationQueue,
  getOfflineMutationQueueLength,
} from "@/shared/services/offlineMutationQueue";

function formatStatusText({
  isOnline,
  pendingCount,
  syncing,
}: {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
}) {
  if (syncing) return "Syncing queued changes...";
  if (!isOnline) {
    if (pendingCount > 0)
      return `Offline. ${pendingCount} pending ${pendingCount > 1 ? "changes" : "change"}.`;
    return "Offline. Changes will be queued automatically.";
  }
  if (pendingCount > 0)
    return `${pendingCount} pending ${pendingCount > 1 ? "changes" : "change"} ready to sync.`;
  return "All changes synced.";
}

export default function OfflineSyncStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [mounted, setMounted] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    const count = await getOfflineMutationQueueLength();
    setPendingCount(Number(count || 0));
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const summary = await drainOfflineMutationQueue({ limit: 50 });
      if (summary && Number.isFinite(summary.remaining)) {
        setPendingCount(summary.remaining);
      } else {
        await refreshPendingCount();
      }
    } finally {
      setSyncing(false);
    }
  }, [refreshPendingCount, syncing]);

  useEffect(() => {
    let cancelled = false;
    setMounted(true);

    const onOnline = () => {
      setIsOnline(true);
      runSync().catch(() => {});
    };

    const onOffline = () => {
      setIsOnline(false);
      refreshPendingCount().catch(() => {});
    };

    const onQueueChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ queueLength?: number; remaining?: number }>).detail;
      const nextCount = Number(detail?.queueLength ?? detail?.remaining);
      if (Number.isFinite(nextCount)) {
        setPendingCount(nextCount);
      } else {
        refreshPendingCount().catch(() => {});
      }
    };

    refreshPendingCount().catch(() => {});

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pod:offline-mutation-enqueued", onQueueChanged);
    window.addEventListener("pod:offline-mutation-drain", onQueueChanged);

    const poll = window.setInterval(() => {
      if (cancelled) return;
      refreshPendingCount().catch(() => {});
    }, 1000 * 30);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pod:offline-mutation-enqueued", onQueueChanged);
      window.removeEventListener("pod:offline-mutation-drain", onQueueChanged);
    };
  }, [refreshPendingCount, runSync]);

  const shouldShow = useMemo(
    () => !isOnline || pendingCount > 0 || syncing,
    [isOnline, pendingCount, syncing],
  );
  if (!mounted || !shouldShow) return null;

  const statusText = formatStatusText({ isOnline, pendingCount, syncing });
  const toneClass = !isOnline
    ? "border-amber-500/40 bg-amber-950/70 text-amber-100"
    : pendingCount > 0
      ? "border-sky-500/40 bg-sky-950/65 text-sky-100"
      : "border-emerald-500/40 bg-emerald-950/70 text-emerald-100";

  return (
    <aside
      className={`fixed bottom-5 left-5 z-[124] w-[calc(100%-2.5rem)] max-w-sm rounded-lg border p-3 shadow-[var(--shadow-lg)] ${toneClass}`}
    >
      <div className="flex items-start gap-2">
        <LucideIcon
          name={!isOnline ? "cloud_off" : syncing ? "progress_activity" : "sync"}
          className={`mt-0.5 text-[16px] ${syncing ? "animate-spin" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{!isOnline ? "Offline Mode" : "Sync Queue"}</p>
          <p className="mt-1 text-xs opacity-90">{statusText}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon="sync"
          loading={syncing}
          disabled={!isOnline || pendingCount <= 0}
          onClick={() => runSync().catch(() => {})}
        >
          Sync now
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => refreshPendingCount().catch(() => {})}
        >
          Refresh
        </Button>
      </div>
    </aside>
  );
}
