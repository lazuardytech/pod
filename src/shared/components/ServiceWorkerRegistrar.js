"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/shared/components/Button";
import LucideIcon from "@/shared/components/LucideIcon";

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 30;

export default function ServiceWorkerRegistrar() {
  const [waitingWorker, setWaitingWorker] = useState(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [activatingUpdate, setActivatingUpdate] = useState(false);
  const reloadedAfterUpdateRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let registration = null;
    let updateInterval = null;

    const announceUpdate = (worker) => {
      if (!worker) return;
      setWaitingWorker(worker);
      setShowUpdatePrompt(true);
    };

    const watchInstallingWorker = (worker) => {
      if (!worker) return;

      worker.addEventListener("statechange", () => {
        if (worker.state !== "installed") return;
        if (!navigator.serviceWorker.controller) return;
        announceUpdate(worker);
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        registration = reg;

        if (reg.waiting) {
          announceUpdate(reg.waiting);
        }

        if (reg.installing) {
          watchInstallingWorker(reg.installing);
        }

        reg.addEventListener("updatefound", () => {
          watchInstallingWorker(reg.installing);
        });

        updateInterval = setInterval(() => {
          reg.update().catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
      })
      .catch(() => {});

    const onVisible = () => {
      if (document.hidden) return;
      registration?.update().catch(() => {});
    };

    const onControllerChange = () => {
      if (reloadedAfterUpdateRef.current) return;
      reloadedAfterUpdateRef.current = true;
      window.location.reload();
    };

    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      if (updateInterval) clearInterval(updateInterval);
      if (registration) registration.onupdatefound = null;
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const handleDismiss = () => {
    setShowUpdatePrompt(false);
    setWaitingWorker(null);
    setActivatingUpdate(false);
  };

  const handleApplyUpdate = () => {
    if (!waitingWorker) return;
    setActivatingUpdate(true);
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  if (!showUpdatePrompt) return null;

  return (
    <aside className="fixed bottom-24 left-1/2 z-[125] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-lg border border-white/10 bg-[#0f1013]/95 p-3 shadow-[var(--shadow-lg)] backdrop-blur">
      <div className="flex items-start gap-2">
        <LucideIcon name="refresh" className="mt-0.5 text-porcelain" size={16} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-porcelain">Update available</p>
          <p className="mt-1 text-xs text-storm-cloud">
            A new Pod version is ready. Update now to apply the latest fixes and behavior.
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          icon="refresh"
          loading={activatingUpdate}
          onClick={handleApplyUpdate}
          disabled={!waitingWorker}
        >
          Update now
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={handleDismiss} disabled={activatingUpdate}>
          Later
        </Button>
      </div>
    </aside>
  );
}
