"use client";
import React from "react";
import { useEffect } from "react";
import { APP_CONFIG } from "@/shared/constants/config";

/**
 * Registers the service worker for offline caching.
 * No auto-update detection — Pod does not self-update.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return undefined;
    }

    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(APP_CONFIG.displayVersion)}`, { scope: "/" })
      .catch((err) => {
        console.warn("[Pod] Service Worker registration failed:", err?.message || err);
        try {
          localStorage.setItem("pod:sw:registration-failed", "1");
        } catch {}
      });

    const onControllerChange = () => {
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
