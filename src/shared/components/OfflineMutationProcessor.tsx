"use client";
import React from "react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { drainOfflineMutationQueue } from "@/shared/services/offlineMutationQueue";

const RETRY_INTERVAL_MS = 1000 * 30;
const QUEUE_TOAST_DEBOUNCE_MS = 2500;

export default function OfflineMutationProcessor() {
  const isDrainingRef = useRef(false);
  const lastQueueToastAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    const runDrain = async () => {
      if (cancelled || isDrainingRef.current) return;
      isDrainingRef.current = true;
      try {
        const summary = await drainOfflineMutationQueue({ limit: 30 });
        if (cancelled || !summary) return;

        if (summary.succeeded > 0) {
          const suffix = summary.succeeded > 1 ? "changes" : "change";
          toast.success(`${summary.succeeded} queued ${suffix} synced.`);
        }
        if (summary.dropped > 0) {
          const suffix = summary.dropped > 1 ? "changes" : "change";
          toast.warning(`${summary.dropped} queued ${suffix} could not be synced.`);
        }
      } finally {
        isDrainingRef.current = false;
      }
    };

    const onOnline = () => {
      runDrain().catch(() => {});
    };

    const onVisible = () => {
      if (document.hidden) return;
      runDrain().catch(() => {});
    };

    const onQueued = (event) => {
      const now = Date.now();
      if (now - lastQueueToastAtRef.current < QUEUE_TOAST_DEBOUNCE_MS) return;
      lastQueueToastAtRef.current = now;

      const queueLength = Number(event?.detail?.queueLength || 0);
      if (queueLength > 0) {
        toast.info(`Offline: queued ${queueLength} pending ${queueLength > 1 ? "changes" : "change"}.`);
      } else {
        toast.info("Offline: change queued and will sync when online.");
      }
    };

    runDrain().catch(() => {});
    intervalId = window.setInterval(() => runDrain().catch(() => {}), RETRY_INTERVAL_MS);

    window.addEventListener("online", onOnline);
    window.addEventListener("pod:offline-mutation-enqueued", onQueued);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pod:offline-mutation-enqueued", onQueued);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
