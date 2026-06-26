"use client";
import React from "react";
import { useEffect, useState } from "react";
import Button from "@/shared/components/Button";
import LucideIcon from "@/shared/components/LucideIcon";

const DISMISS_KEY = "pod:pwa-install:dismissed-at";
const DISMISS_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 7;

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
}

function isIOS() {
  if (typeof window === "undefined") return false;

  const ua = window.navigator.userAgent.toLowerCase();
  const iOSByUA = /iphone|ipad|ipod/.test(ua);
  const iPadByPlatform = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;

  return iOSByUA || iPadByPlatform;
}

function wasDismissedRecently() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  const at = Number(raw || 0);
  if (!Number.isFinite(at) || at <= 0) return false;
  return Date.now() - at < DISMISS_COOLDOWN_MS;
}

function markDismissedNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISS_KEY, Date.now().toString());
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [canPromptInstall, setCanPromptInstall] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || isStandaloneMode() || wasDismissedRecently()) {
      return undefined;
    }

    const iOSHintEligible = isIOS();
    if (iOSHintEligible) {
      setShowIosHint(true);
      setVisible(true);
    }

    const onBeforeInstallPrompt = (event: any) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setCanPromptInstall(true);
      setShowIosHint(false);
      setVisible(true);
    };

    const onAppInstalled = () => {
      setVisible(false);
      setCanPromptInstall(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const dismiss = () => {
    markDismissedNow();
    setVisible(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt || typeof deferredPrompt.prompt !== "function") return;

    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome !== "accepted") {
        markDismissedNow();
      }
    } catch {
      markDismissedNow();
    } finally {
      setInstalling(false);
      setCanPromptInstall(false);
      setDeferredPrompt(null);
      setVisible(false);
    }
  };

  if (!visible) return null;

  return (
    <aside className="fixed bottom-4 left-1/2 z-[120] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-lg border border-white/10 bg-[#0f1013]/95 p-3 shadow-[var(--shadow-lg)] backdrop-blur">
      <div className="flex items-start gap-2">
        <LucideIcon name={canPromptInstall ? "download" : "apps"} className="mt-0.5 text-porcelain" size={16} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-porcelain">Install Pod</p>
          {canPromptInstall ? (
            <p className="mt-1 text-xs text-storm-cloud">
              Install Pod as an app for faster launch, standalone mode, and better offline behavior.
            </p>
          ) : showIosHint ? (
            <p className="mt-1 text-xs text-storm-cloud">
              On iPhone/iPad, use Safari: tap Share, then choose Add to Home Screen.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-1 text-storm-cloud transition-colors hover:bg-white/10 hover:text-porcelain"
          aria-label="Dismiss install prompt"
        >
          <LucideIcon name="close" size={14} />
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        {canPromptInstall ? (
          <Button type="button" size="sm" icon="download" loading={installing} onClick={handleInstall}>
            Install
          </Button>
        ) : null}
        <Button type="button" size="sm" variant={canPromptInstall ? "secondary" : "primary"} onClick={dismiss}>
          {canPromptInstall ? "Not now" : "Got it"}
        </Button>
      </div>
    </aside>
  );
}
