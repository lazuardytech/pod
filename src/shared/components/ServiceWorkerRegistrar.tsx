"use client";
import { useEffect } from "react";
import { APP_CONFIG } from "@/shared/constants/config";

/**
 * Resolves the service-worker version. Prefers the per-build deploy hash
 * written to /sw-version.json at build time so each deploy gets an isolated
 * SW cache namespace (stale app-shells from prior builds are evicted on
 * activate). Falls back to the release semver when the file is unavailable
 * (e.g. local dev, where the SW is registered with `?v=dev`).
 */
async function resolveSwVersion(): Promise<string> {
  try {
    const res = await fetch("/sw-version.json", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (data?.version) return data.version;
    }
  } catch {}
  return APP_CONFIG.displayVersion;
}

/**
 * Registers the service worker for offline caching.
 * No auto-update detection — Pod does not self-update.
 */
export default function ServiceWorkerRegistrar(): any {
  useEffect((): any => {
    if (!("serviceWorker" in navigator)) {
      return undefined;
    }

    let cancelled = false;
    const onControllerChange = (): any => {
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    (async () => {
      const version = await resolveSwVersion();
      if (cancelled) return;
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" })
        .catch((err): any => {
          console.warn("[Pod] Service Worker registration failed:", err?.message || err);
          try {
            localStorage.setItem("pod:sw:registration-failed", "1");
          } catch {}
        });
    })();

    return (): any => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
