"use client";

import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardSkeleton, Input, Modal, SegmentedControl, Toggle } from "@/shared/components";
import { ConfirmModal } from "@/shared/components/Modal";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import LucideIcon from "@/shared/components/LucideIcon";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";
import { mutateJsonWithOfflineQueue } from "@/shared/services/offlineMutationRequest";

const TUNNEL_BENEFITS = [
  { icon: "public", title: "Access Anywhere", desc: "Use your API from any network" },
  { icon: "group", title: "Share Endpoint", desc: "Share URL with team members" },
  { icon: "code", title: "Use in Cursor/Cline", desc: "Connect AI tools remotely" },
  { icon: "lock", title: "Encrypted", desc: "End-to-end TLS via Cloudflare" },
];

const TUNNEL_PING_INTERVAL_MS = 2000;
const TUNNEL_PING_MAX_MS = 300000;
const OFFLINE_SETTINGS_CACHE_KEY = "endpoint:settings";
const OFFLINE_TUNNEL_STATUS_CACHE_KEY = "endpoint:tunnel-status";
const OFFLINE_KEYS_CACHE_KEY = "endpoint:keys";
const OFFLINE_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;
const ENDPOINT_ICON_BUTTON_CLASS =
  "flex size-9 items-center justify-center rounded-[6px] text-storm-cloud transition-colors hover:bg-deep-slate hover:text-porcelain shrink-0";
const ENDPOINT_DANGER_BUTTON_CLASS =
  "flex size-9 items-center justify-center rounded-[6px] text-warning-red transition-colors hover:bg-warning-red/10 shrink-0";

const CAVEMAN_LEVELS = [
  { id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
  { id: "full", label: "Full", desc: "Drop articles, fragments OK" },
  { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
];
export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [editKeyName, setEditKeyName] = useState("");
  const [keysPage, setKeysPage] = useState(1);
  const KEYS_PAGE_SIZE = 15;
  const [newKeyLimitType, setNewKeyLimitType] = useState("unlimited");
  const [newKeyRpm, setNewKeyRpm] = useState("60");
  const [newKeyConcurrent, setNewKeyConcurrent] = useState("5");
  const [createdKey, setCreatedKey] = useState(null);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
  const [rtkEnabled, setRtkEnabledState] = useState(false);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");

  // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const setTsError = (msg) => {
    if (typeof msg === "string" && msg.includes("exited with code")) {
      toast.error("Failed to start Tailscale");
    } else {
      setTsStatus({ type: "error", message: msg });
    }
  };
  const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef(null);
  const tunnelStatusSigRef = useRef("");
  const offlineNoticeShownRef = useRef(false);
  const unmountRef = useRef(false);

  // Cleanup on unmount — stops all polling loops
  useEffect(() => {
    return () => {
      unmountRef.current = true;
    };
  }, []);

  // API key visibility toggle state
  const [visibleKeys, setVisibleKeys] = useState(new Set());

  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null,
    variant: "default",
  });
  const openConfirm = (title, message, onConfirm, variant = "default") =>
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () => setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }));

  const { copied, copy } = useCopyToClipboard();

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);

  const applyTunnelStatus = useCallback((data) => {
    if (!data || typeof data !== "object") return;

    const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
    const tUrl = data.tunnel?.tunnelUrl || "";
    const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
    const tsUrlVal = data.tailscale?.tunnelUrl || "";
    const sig = `${tEnabled}|${tUrl}|${tsEn}|${tsUrlVal}`;

    if (sig === tunnelStatusSigRef.current) return;
    tunnelStatusSigRef.current = sig;

    setTunnelUrl((prev) => (prev === tUrl ? prev : tUrl));
    setTunnelEnabled((prev) => (prev === tEnabled ? prev : tEnabled));
    setTsUrl((prev) => (prev === tsUrlVal ? prev : tsUrlVal));
    setTsEnabled((prev) => (prev === tsEn ? prev : tsEn));
  }, []);

  const applySettingsData = useCallback((data) => {
    if (!data || typeof data !== "object") return;
    setRequireApiKey(data.requireApiKey || false);
    setRequireLogin(data.requireLogin !== false);
    setHasPassword(data.hasPassword || false);
    setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
    setRtkEnabledState(!!data.rtkEnabled);
    setCavemanEnabled(!!data.cavemanEnabled);
    setCavemanLevel(data.cavemanLevel || "full");
  }, []);

  const notifyOfflineCache = useCallback(() => {
    if (offlineNoticeShownRef.current) return;
    offlineNoticeShownRef.current = true;
    toast.info("Network unavailable. Showing cached data.");
  }, []);

  const clearOfflineCacheNotice = useCallback(() => {
    offlineNoticeShownRef.current = false;
  }, []);

  // Trust user intent (settingsEnabled): UI stays "enabled" while watchdog restarts process
  const syncTunnelStatus = useCallback(async () => {
    try {
      const result = await loadJsonStaleWhileRevalidate({
        url: "/api/tunnel/status",
        cacheKey: OFFLINE_TUNNEL_STATUS_CACHE_KEY,
        maxStaleMs: OFFLINE_MAX_STALE_MS,
        cacheTags: ["tunnel-status"],
        fetchOptions: { cache: "no-store" },
        onCacheData: (data) => {
          applyTunnelStatus(data);
        },
        onFreshData: (data) => {
          applyTunnelStatus(data);
        },
      });

      if (result.source === "cache") notifyOfflineCache();
      else clearOfflineCacheNotice();

      return result.data || null;
    } catch {
      return null;
    }
  }, [applyTunnelStatus, clearOfflineCacheNotice, notifyOfflineCache]);

  const shouldPollTunnelStatus =
    tunnelEnabled || tsEnabled || tunnelLoading || tsLoading || tunnelChecking || tsConnecting;

  useEffect(() => {
    if (!shouldPollTunnelStatus) return;

    let closed = false;
    let reconnectTimer = null;
    let es = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/tunnel/status/stream");

      es.addEventListener("status", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.error) return;
          applyTunnelStatus(payload);
        } catch {
          // ignore malformed event and keep stream alive
        }
      });

      es.onerror = () => {
        es.close();
        syncTunnelStatus().catch(() => {});
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    // Keep a one-shot fetch to avoid waiting for reconnect backoff.
    syncTunnelStatus().catch(() => {});
    connect();

    const onVisible = () => {
      if (!document.hidden) syncTunnelStatus().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applyTunnelStatus, shouldPollTunnelStatus, syncTunnelStatus]);

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsResult, statusResult] = await Promise.all([
        loadJsonStaleWhileRevalidate({
          url: "/api/settings",
          cacheKey: OFFLINE_SETTINGS_CACHE_KEY,
          maxStaleMs: OFFLINE_MAX_STALE_MS,
          cacheTags: ["settings"],
          onCacheData: (data) => {
            applySettingsData(data);
          },
          onFreshData: (data) => {
            applySettingsData(data);
          },
        }),
        loadJsonStaleWhileRevalidate({
          url: "/api/tunnel/status",
          cacheKey: OFFLINE_TUNNEL_STATUS_CACHE_KEY,
          maxStaleMs: OFFLINE_MAX_STALE_MS,
          cacheTags: ["tunnel-status"],
          fetchOptions: { cache: "no-store" },
          onCacheData: (data) => {
            applyTunnelStatus(data);
          },
          onFreshData: (data) => {
            applyTunnelStatus(data);
          },
        }),
      ]);

      if (settingsResult.source === "cache" || statusResult.source === "cache") {
        notifyOfflineCache();
      } else {
        clearOfflineCacheNotice();
      }

      if (statusResult?.data) {
        const data = statusResult.data;
        const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
        const tUrl = data.tunnel?.tunnelUrl || "";
        const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
        const tsUrlVal = data.tailscale?.tunnelUrl || "";

        // Background reachability probes (non-blocking, only show warning)
        if (tEnabled && tUrl) {
          const healthUrl = `${tUrl}/api/health`;
          fetch(healthUrl, { cache: "no-store" })
            .then((r) => {
              if (!r.ok) setTunnelStatus({ type: "warning", message: "Tunnel reconnecting..." });
            })
            .catch(() => setTunnelStatus({ type: "warning", message: "Tunnel reconnecting..." }));
        }
        if (tsEn && tsUrlVal) {
          fetch(`${tsUrlVal}/api/health`, { mode: "no-cors", cache: "no-store" })
            .then((r) => {
              if (!(r.ok || r.type === "opaque"))
                setTsStatus({ type: "warning", message: "Tailscale reconnecting..." });
            })
            .catch(() => setTsStatus({ type: "warning", message: "Tailscale reconnecting..." }));
        }
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value) => {
    const previous = tunnelDashboardAccess;
    setTunnelDashboardAccess(value);
    const result = await patchSetting(
      { tunnelDashboardAccess: value },
      { feature: "endpoint-tunnel-dashboard-access" },
    );
    if (result?.error) {
      setTunnelDashboardAccess(previous);
    }
  };

  const handleRequireApiKey = async (value) => {
    const previous = requireApiKey;
    setRequireApiKey(value);
    const result = await patchSetting({ requireApiKey: value }, { feature: "endpoint-require-api-key" });
    if (result?.error) {
      setRequireApiKey(previous);
    }
  };

  const handleRtkEnabled = async (value) => {
    const previous = rtkEnabled;
    setRtkEnabledState(value);
    const result = await patchSetting({ rtkEnabled: value }, { feature: "endpoint-rtk-enabled" });
    if (result?.error) {
      setRtkEnabledState(previous);
    }
  };

  const patchSetting = async (patch, { feature = "endpoint-settings" } = {}) => {
    try {
      const result = await mutateJsonWithOfflineQueue({
        url: "/api/settings",
        method: "PATCH",
        body: patch,
        queueMeta: { feature, patch },
        invalidateCacheTags: ["settings"],
      });
      return result;
    } catch (error) {
      console.error("Error updating setting:", error);
      toast.error("Failed to update settings");
      return { error };
    }
  };

  const handleCavemanEnabled = (value) => {
    const previous = cavemanEnabled;
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value }, { feature: "endpoint-caveman-enabled" }).then((result) => {
      if (result?.error) setCavemanEnabled(previous);
    });
  };

  const handleCavemanLevel = (level) => {
    const previous = cavemanLevel;
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level }, { feature: "endpoint-caveman-level" }).then((result) => {
      if (result?.error) setCavemanLevel(previous);
    });
  };

  const fetchData = async () => {
    try {
      const result = await loadJsonStaleWhileRevalidate({
        url: "/api/keys",
        cacheKey: OFFLINE_KEYS_CACHE_KEY,
        maxStaleMs: OFFLINE_MAX_STALE_MS,
        cacheTags: ["api-keys"],
        onCacheData: (data) => {
          setKeys(data?.keys || []);
        },
        onFreshData: (data) => {
          setKeys(data?.keys || []);
        },
      });

      if (result.source === "cache") {
        notifyOfflineCache();
      } else {
        clearOfflineCacheNotice();
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // u2500u2500u2500 Cloudflare Tunnel handlers
  // Ping tunnel health until reachable, also check backend status to detect process die
  // Background health probe — fire-and-forget, never blocks UI, never shows errors
  const backgroundTunnelHealth = (url) => {
    if (!url) return;
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    const check = async () => {
      while (Date.now() - start < TUNNEL_PING_MAX_MS) {
        if (unmountRef.current) return;
        await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
        try {
          const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
          if (ping.ok || ping.type === "opaque") return; // reachable — done
        } catch {
          /* not ready yet */
        }
        // Every ~10s check if backend process died
        if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
          try {
            const statusRes = await fetch("/api/tunnel/status");
            if (statusRes.ok) {
              const status = await statusRes.json();
              if (!status.tunnel?.settingsEnabled) {
                setTunnelEnabled(false);
                setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
                return;
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
      // Timed out — tunnel URL may still work, just not reachable from this browser
    };
    check().catch(() => {});
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    // Fire the enable request without awaiting — avoids Safari fetch timeout
    // (cloudflared download + spawn can take 30-90s, exceeding browser defaults).
    fetch("/api/tunnel/enable", { method: "POST" }).catch(() => {
      // POST may timeout in browser — completion detected via status polling below
    });

    // Poll /api/tunnel/status until tunnel is live or overall timeout
    const start = Date.now();
    const OVERALL_TIMEOUT_MS = 180000; // 3 min
    while (Date.now() - start < OVERALL_TIMEOUT_MS) {
      if (unmountRef.current) return;
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const r = await fetch("/api/tunnel/status");
        if (!r.ok) continue;
        const s = await r.json();

        // Show download progress
        if (s.download?.downloading) {
          const pct = s.download.progress;
          setTunnelProgress(pct < 100 ? `Downloading cloudflared... ${pct}%` : "Creating tunnel...");
        } else {
          setTunnelProgress("Creating tunnel...");
        }

        // Tunnel is live — show URL immediately
        if (s.tunnel?.enabled && s.tunnel?.tunnelUrl) {
          setTunnelUrl(s.tunnel.tunnelUrl || "");
          setTunnelEnabled(true);
          setTunnelLoading(false);
          setTunnelProgress("");
          // Background health check — non-blocking
          backgroundTunnelHealth(s.tunnel.tunnelUrl);
          // Refresh full data — non-fatal
          fetchData().catch(() => {});
          return;
        }
      } catch {
        /* poll error — retry next tick */
      }
    }

    // Final check before showing timeout error
    try {
      const r = await fetch("/api/tunnel/status");
      if (r.ok) {
        const s = await r.json();
        if (s.tunnel?.enabled && s.tunnel?.tunnelUrl) {
          setTunnelUrl(s.tunnel.tunnelUrl || "");
          setTunnelEnabled(true);
          setTunnelLoading(false);
          setTunnelProgress("");
          backgroundTunnelHealth(s.tunnel.tunnelUrl);
          fetchData().catch(() => {});
          return;
        }
      }
    } catch {
      /* fall through */
    }

    setTunnelStatus({ type: "error", message: "Tunnel creation timed out. Please check your network and try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  // u2500u2500u2500 Tailscale handlers
  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch {
      /* ignore */
    }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try {
                data = JSON.parse(line.slice(6));
              } catch {
                /* skip */
              }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            return;
          } else if (event === "error") {
            setTsError(data.error || "Install failed");
          }
        }
      }
    } catch (e) {
      setTsError(e.message);
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      if (unmountRef.current) return false;
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch {
        /* not ready yet */
      }
    }
    return false;
  };

  const handleConnectTailscale = async (preOpenedTab) => {
    const tab = preOpenedTab || null;
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        if (tab) tab.close();
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        if (reachable) {
          setTsEnabled(true);
          setTsStatus(null);
        } else {
          setTsEnabled(true);
          setTsStatus({ type: "warning", message: "Connected but not reachable yet." });
        }
        return;
      }

      // Needs login: redirect pre-opened tab or open new
      if (data.needsLogin && data.authUrl) {
        if (tab) tab.location.href = data.authUrl;
        else window.open(data.authUrl, "tailscale_auth", "width=600,height=700");
        setTsProgress("Waiting for login...");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  if (tab) tab.close();
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  if (ok2) {
                    setTsEnabled(true);
                    setTsStatus(null);
                  } else {
                    setTsEnabled(true);
                    setTsStatus({ type: "warning", message: "Connected but not reachable yet." });
                  }
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl, tab);
                } else {
                  setTsError(data2.error || "Failed to start funnel");
                }
                return;
              }
            }
          } catch {
            /* retry */
          }
        }
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }

      // Funnel not enabled: redirect pre-opened tab
      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl, tab);
        return;
      }

      if (tab) tab.close();
      setTsError(data.error || "Failed to connect");
    } catch (error) {
      if (tab) tab.close();
      setTsError(error.message);
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
    }
  };

  const pollFunnelEnable = async (enableUrl, tab) => {
    if (tab) tab.location.href = enableUrl;
    else window.open(enableUrl, "tailscale_auth", "width=600,height=700");
    setTsProgress("Enable Funnel in browser, waiting...");
    for (let i = 0; i < 40; i++) {
      if (unmountRef.current) return;
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          if (tab) tab.close();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          if (ok3) {
            setTsEnabled(true);
            setTsStatus(null);
          } else {
            setTsEnabled(true);
            setTsStatus({ type: "warning", message: "Connected but not reachable yet." });
          }
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          setTsError(data.error);
          return;
        }
      } catch {
        /* retry */
      }
    }
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsError(data.error || "Failed to disable Tailscale");
      }
    } catch (e) {
      setTsError(e.message);
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    setShowTsModal(true);
    await checkTailscaleInstalled();
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    if (newKeyLimitType === "limited") {
      const rpm = Number(newKeyRpm);
      const concurrent = Number(newKeyConcurrent);
      if (!Number.isFinite(rpm) || !Number.isInteger(rpm) || rpm <= 0) return;
      if (!Number.isFinite(concurrent) || !Number.isInteger(concurrent) || concurrent <= 0) return;
    }

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName,
          limitType: newKeyLimitType,
          requestsPerMinute: newKeyLimitType === "limited" ? Number(newKeyRpm) : null,
          concurrentRequests: newKeyLimitType === "limited" ? Number(newKeyConcurrent) : null,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        resetCreateKeyForm();
      }
    } catch (error) {
      console.error("Error creating key:", error);
    }
  };

  const resetCreateKeyForm = () => {
    setNewKeyName("");
    setNewKeyLimitType("unlimited");
    setNewKeyRpm("60");
    setNewKeyConcurrent("5");
    setShowAddModal(false);
  };

  const handleDeleteKey = async (id) => {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys(keys.filter((k) => k.id !== id));
        setVisibleKeys((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch (error) {
      console.error("Error deleting key:", error);
    }
  };

  const handleEditKey = (key) => {
    setEditingKey(key);
    setEditKeyName(key.name);
  };

  const handleUpdateKey = async () => {
    if (!editKeyName.trim() || !editingKey) return;
    try {
      const res = await fetch(`/api/keys/${editingKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editKeyName.trim() }),
      });
      if (res.ok) {
        setKeys(keys.map((k) => (k.id === editingKey.id ? { ...k, name: editKeyName.trim() } : k)));
        setEditingKey(null);
        setEditKeyName("");
      }
    } catch (error) {
      console.error("Error updating key:", error);
    }
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, isActive } : k)));
      }
    } catch (error) {
      console.error("Error toggling key:", error);
    }
  };

  const maskKey = (fullKey) => {
    if (!fullKey) return "";
    return fullKey.length > 8 ? fullKey.slice(0, 8) + "..." : fullKey;
  };

  const toggleKeyVisibility = (keyId) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const [baseUrl, setBaseUrl] = useState("/v1");
  const hasValidCreateRateLimitInputs =
    newKeyLimitType !== "limited" ||
    (Number.isInteger(Number(newKeyRpm)) &&
      Number(newKeyRpm) > 0 &&
      Number.isInteger(Number(newKeyConcurrent)) &&
      Number(newKeyConcurrent) > 0);

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  const currentEndpoint = baseUrl;
  const showTunnelEnableAction = !tunnelEnabled && !tunnelLoading && !tunnelChecking;
  const showTsEnableAction = !tsEnabled && !tsLoading && !tsConnecting;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EndpointValueCard
          title="OpenAI"
          icon="api"
          url={currentEndpoint}
          copyId="openai_url"
          copied={copied}
          onCopy={copy}
        />
        <EndpointValueCard
          title="Anthropic"
          icon="api"
          url={currentEndpoint}
          copyId="anthropic_url"
          copied={copied}
          onCopy={copy}
        />

        <Card
          title="Tunnel"
          icon="cloud_upload"
          action={
            showTunnelEnableAction ? (
              <Button
                size="sm"
                icon="cloud_upload"
                onClick={() => {
                  if (!requireApiKey) {
                    setTunnelStatus({
                      type: "error",
                      message: 'Security required: Enable "Require API key" before activating the tunnel.',
                    });
                    return;
                  }
                  setShowEnableTunnelModal(true);
                }}
              >
                Enable
              </Button>
            ) : null
          }
        >
          <div className="flex flex-col gap-3">
            {tunnelEnabled && !tunnelLoading ? (
              <div className="flex items-center gap-2">
                <Input value={`${tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
                <button
                  onClick={() => copy(`${tunnelUrl}/v1`, "tunnel_url")}
                  className={ENDPOINT_ICON_BUTTON_CLASS}
                  title="Copy tunnel URL"
                >
                  <LucideIcon name={copied === "tunnel_url" ? "check" : "content_copy"} size={16} />
                </button>
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Disable Tunnel"
                >
                  <LucideIcon name="power_settings_new" size={16} />
                </button>
              </div>
            ) : tunnelLoading ? (
              <div className="flex items-start gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-[6px] border border-charcoal-grey bg-pitch-black px-3 py-2 text-sm text-storm-cloud">
                  <LucideIcon name="progress_activity" size={14} className="animate-spin shrink-0" />
                  <span>{tunnelProgress || "Creating tunnel..."}</span>
                </div>
                <button
                  onClick={() => {
                    setTunnelLoading(false);
                    setTunnelProgress("");
                  }}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Stop"
                >
                  <LucideIcon name="power_settings_new" size={16} />
                </button>
              </div>
            ) : tunnelStatus?.type === "error" ? (
              <div className="flex items-start gap-2 rounded-[6px] border border-warning-red/25 bg-warning-red/8 px-3 py-2 text-sm text-warning-red">
                <LucideIcon name="error" size={14} className="mt-0.5 shrink-0" />
                <span>{tunnelStatus.message}</span>
              </div>
            ) : tunnelChecking ? (
              <div className="flex items-start gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-[6px] border border-charcoal-grey bg-pitch-black px-3 py-2 text-sm text-storm-cloud">
                  <LucideIcon name="progress_activity" size={14} className="animate-spin shrink-0" />
                  <span>Checking...</span>
                </div>
                <button onClick={() => setTunnelChecking(false)} className={ENDPOINT_DANGER_BUTTON_CLASS} title="Stop">
                  <LucideIcon name="power_settings_new" size={16} />
                </button>
              </div>
            ) : (
              <p className="text-sm text-storm-cloud">Expose your local Pod API with a secure public endpoint.</p>
            )}
          </div>
        </Card>

        <Card
          title="Tailscale"
          icon="vpn_lock"
          action={
            showTsEnableAction ? (
              <Button size="sm" icon="vpn_lock" onClick={handleOpenTsModal}>
                Enable
              </Button>
            ) : null
          }
        >
          <div className="flex flex-col gap-3">
            {tsEnabled && !tsLoading ? (
              <div className="flex items-center gap-2">
                <Input value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
                <button
                  onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                  className={ENDPOINT_ICON_BUTTON_CLASS}
                  title="Copy Tailscale URL"
                >
                  <LucideIcon name={copied === "ts_url" ? "check" : "content_copy"} size={16} />
                </button>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Disable Tailscale"
                >
                  <LucideIcon name="power_settings_new" size={16} />
                </button>
              </div>
            ) : tsLoading || tsConnecting ? (
              <div className="flex items-start gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-[6px] border border-charcoal-grey bg-pitch-black px-3 py-2 text-sm text-storm-cloud">
                  <LucideIcon name="progress_activity" size={14} className="animate-spin shrink-0" />
                  <span>{tsProgress || "Connecting..."}</span>
                </div>
                <button
                  onClick={() => {
                    setTsLoading(false);
                    setTsConnecting(false);
                    setTsProgress("");
                  }}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Stop"
                >
                  <LucideIcon name="power_settings_new" size={16} />
                </button>
              </div>
            ) : tsStatus?.type === "error" ? (
              <div className="flex items-start gap-2 rounded-[6px] border border-warning-red/25 bg-warning-red/8 px-3 py-2 text-sm text-warning-red">
                <LucideIcon name="error" size={14} className="mt-0.5 shrink-0" />
                <span>{tsStatus.message}</span>
              </div>
            ) : (
              <p className="text-sm text-storm-cloud">Make Pod reachable on your private Tailscale network.</p>
            )}
          </div>
        </Card>
      </div>

      {(tunnelEnabled || tsEnabled) && (
        <Card title="Remote Access" icon="public">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {!requireApiKey && (
                <SecurityWarning
                  message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                  action={{ label: "Enable", href: "#require-api-key" }}
                />
              )}
              {(!requireLogin || !hasPassword) && (
                <SecurityWarning
                  message={
                    !requireLogin
                      ? "Require login is disabled — anyone can access your dashboard via tunnel."
                      : "Dashboard uses the default password — change it in Profile settings."
                  }
                  action={{
                    label: !requireLogin ? "Enable" : "Change password",
                    href: "/settings",
                  }}
                />
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-4">
              <Toggle
                checked={tunnelDashboardAccess}
                onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
              />
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
                <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Token Saver (RTK + Caveman) */}
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <LucideIcon name="bolt" className="text-primary" />
            Token Saver
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress tool output{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">git/grep/ls/tree/logs → 60-90% fewer input tokens</p>
          </div>
          <Toggle checked={rtkEnabled} onChange={() => handleRtkEnabled(!rtkEnabled)} />
        </div>
        <div className="flex items-center justify-between pt-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress LLM output{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">Terse-style system prompt → ~65% fewer output tokens (up to 87%)</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {cavemanEnabled && (
              <div className="flex items-center gap-1.5">
                {CAVEMAN_LEVELS.map((lvl) => (
                  <button
                    key={lvl.id}
                    onClick={() => handleCavemanLevel(lvl.id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      cavemanLevel === lvl.id
                        ? "bg-primary text-primary-fg border-primary"
                        : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                    }`}
                    title={lvl.desc}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            )}
            <Toggle checked={cavemanEnabled} onChange={() => handleCavemanEnabled(!cavemanEnabled)} />
          </div>
        </div>
      </Card>

      {/* API Keys */}
      <Card id="require-api-key">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <LucideIcon name="vpn_key" className="text-primary" />
            API Keys
          </h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
          <div>
            <p className="font-medium">Require API key</p>
            <p className="text-sm text-text-muted">Requests without a valid key will be rejected</p>
          </div>
          <Toggle checked={requireApiKey} onChange={() => handleRequireApiKey(!requireApiKey)} />
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <LucideIcon name="vpn_key" className="text-[32px]" />
            </div>
            <p className="text-text-main font-medium mb-1">No API keys yet</p>
            <p className="text-sm text-text-muted mb-4">Create your first API key to get started</p>
            <Button icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="rounded-[6px] border border-charcoal-grey overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-charcoal-grey bg-pitch-black/40">
                    <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                      Name
                    </th>
                    <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                      Key
                    </th>
                    <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                      Limit
                    </th>
                    <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                      Created At
                    </th>
                    <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                      Last Access At
                    </th>
                    <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey w-[100px]">
                      Status
                    </th>
                    <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey w-[72px] text-end">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.slice((keysPage - 1) * KEYS_PAGE_SIZE, keysPage * KEYS_PAGE_SIZE).map((key) => (
                    <tr
                      key={key.id}
                      className={`group border-b border-charcoal-grey/50 last:border-0 hover:bg-deep-slate transition-colors duration-100 ${
                        key.isActive === false ? "opacity-60" : ""
                      }`}
                    >
                      {/* Name */}
                      <td className="px-3 py-2 border-r border-charcoal-grey/50">
                        <span className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]">{key.name}</span>
                      </td>

                      {/* Key */}
                      <td className="px-3 py-2 border-r border-charcoal-grey/50">
                        <div className="flex items-center gap-1.5">
                          <code className="text-[11px] text-storm-cloud font-mono">
                            {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                          </code>
                          <button
                            onClick={() => toggleKeyVisibility(key.id)}
                            className="flex items-center justify-center size-5 rounded-[3px] text-fog-grey hover:text-porcelain hover:bg-charcoal-grey opacity-0 group-hover:opacity-100 transition-all duration-100"
                            title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                          >
                            <LucideIcon
                              name={visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                              className="text-[12px]"
                            />
                          </button>
                          <button
                            onClick={() => copy(key.key, key.id)}
                            className="flex items-center justify-center size-5 rounded-[3px] text-fog-grey hover:text-porcelain hover:bg-charcoal-grey opacity-0 group-hover:opacity-100 transition-all duration-100"
                            title="Copy key"
                          >
                            <LucideIcon name={copied === key.id ? "check" : "content_copy"} className="text-[12px]" />
                          </button>
                        </div>
                      </td>

                      {/* Limit */}
                      <td className="px-3 py-2 border-r border-charcoal-grey/50">
                        {key.limitType === "limited" ? (
                          <span className="text-[11px] text-aether-blue">
                            {key.requestsPerMinute || 0} req/min · {key.concurrentRequests || 0} concurrent
                          </span>
                        ) : (
                          <span className="text-[11px] text-emerald">Unlimited</span>
                        )}
                      </td>

                      {/* Created At */}
                      <td className="px-3 py-2 border-r border-charcoal-grey/50 text-fog-grey font-mono text-[11px]">
                        {new Date(key.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>

                      {/* Last Access At */}
                      <td className="px-3 py-2 border-r border-charcoal-grey/50 text-fog-grey font-mono text-[11px]">
                        {key.lastAccessAt
                          ? new Date(key.lastAccessAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2 border-r border-charcoal-grey/50">
                        <div className="flex items-center gap-2">
                          <Badge variant={key.isActive !== false ? "success" : "error"} size="sm">
                            {key.isActive !== false ? "Enabled" : "Disabled"}
                          </Badge>
                          <Toggle
                            size="sm"
                            checked={key.isActive ?? true}
                            onChange={(checked) => {
                              if (key.isActive && !checked) {
                                openConfirm(
                                  "Pause API Key",
                                  `Pause API key "${key.name}"? This key will stop working immediately but can be resumed later.`,
                                  () => handleToggleKey(key.id, checked),
                                  "danger",
                                );
                              } else {
                                handleToggleKey(key.id, checked);
                              }
                            }}
                            title={key.isActive ? "Pause key" : "Resume key"}
                          />
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2 w-[72px]">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleEditKey(key)}
                            className="flex items-center justify-center size-6 rounded-[4px] text-fog-grey hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
                            title="Edit key"
                          >
                            <LucideIcon name="edit" className="text-[14px]" />
                          </button>
                          <button
                            onClick={() =>
                              openConfirm(
                                "Delete API Key",
                                "Are you sure you want to delete this API key? This action cannot be undone.",
                                () => handleDeleteKey(key.id),
                                "danger",
                              )
                            }
                            className="flex items-center justify-center size-6 rounded-[4px] text-fog-grey hover:bg-warning-red/10 hover:text-warning-red transition-colors duration-100"
                            title="Delete key"
                          >
                            <LucideIcon name="delete" className="text-[14px]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {keys.length > KEYS_PAGE_SIZE && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-charcoal-grey">
                <span className="text-[11px] text-fog-grey">
                  {(keysPage - 1) * KEYS_PAGE_SIZE + 1}–{Math.min(keysPage * KEYS_PAGE_SIZE, keys.length)} of{" "}
                  {keys.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setKeysPage((p) => Math.max(1, p - 1))}
                    disabled={keysPage === 1}
                    className="flex items-center justify-center size-6 rounded-[4px] border border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain disabled:opacity-40 transition-colors duration-100"
                  >
                    <LucideIcon name="chevron_left" className="text-[14px]" />
                  </button>
                  {Array.from({ length: Math.ceil(keys.length / KEYS_PAGE_SIZE) }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      onClick={() => setKeysPage(p)}
                      className={`flex items-center justify-center size-6 rounded-[4px] text-[11px] font-[510] transition-colors duration-100 ${
                        p === keysPage
                          ? "bg-porcelain/10 text-porcelain border border-porcelain/20"
                          : "text-fog-grey hover:bg-deep-slate hover:text-porcelain border border-transparent"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    onClick={() => setKeysPage((p) => Math.min(Math.ceil(keys.length / KEYS_PAGE_SIZE), p + 1))}
                    disabled={keysPage === Math.ceil(keys.length / KEYS_PAGE_SIZE)}
                    className="flex items-center justify-center size-6 rounded-[4px] border border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain disabled:opacity-40 transition-colors duration-100"
                  >
                    <LucideIcon name="chevron_right" className="text-[14px]" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <ConfirmModal
        isOpen={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={() => {
          confirmDialog.onConfirm?.();
          closeConfirm();
        }}
        onClose={closeConfirm}
        confirmText="Confirm"
        cancelText="Cancel"
        variant={confirmDialog.variant}
      />

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          resetCreateKeyForm();
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-main">Limit Type</label>
            <SegmentedControl
              value={newKeyLimitType}
              onChange={setNewKeyLimitType}
              options={[
                { value: "unlimited", label: "Unlimited" },
                { value: "limited", label: "Limited" },
              ]}
              size="sm"
              className="w-full"
            />
          </div>
          {newKeyLimitType === "limited" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Request per Minute"
                type="number"
                min={1}
                step={1}
                value={newKeyRpm}
                onChange={(e) => setNewKeyRpm(e.target.value)}
                placeholder="60"
              />
              <Input
                label="Concurrent Request"
                type="number"
                min={1}
                step={1}
                value={newKeyConcurrent}
                onChange={(e) => setNewKeyConcurrent(e.target.value)}
                placeholder="5"
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim() || !hasValidCreateRateLimitInputs}>
              Create
            </Button>
            <Button onClick={resetCreateKeyForm} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Key Modal */}
      <Modal
        isOpen={!!editingKey}
        title="Edit API Key"
        onClose={() => {
          setEditingKey(null);
          setEditKeyName("");
        }}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingKey(null);
                setEditKeyName("");
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleUpdateKey} disabled={!editKeyName.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Key Name"
          value={editKeyName}
          onChange={(e) => setEditKeyName(e.target.value)}
          placeholder="Production Key"
          autoFocus
        />
      </Modal>

      {/* Created Key Modal */}
      <Modal isOpen={!!createdKey} title="API Key Created" onClose={() => setCreatedKey(null)}>
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">Save this key now!</p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2 items-end">
            <Input value={createdKey || ""} readOnly className="flex-1" inputClassName="font-mono text-sm" />
            <Button
              size="lg"
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal isOpen={showEnableTunnelModal} title="Enable Tunnel" onClose={() => setShowEnableTunnelModal(false)}>
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <LucideIcon name="cloud_upload" className="text-primary" />
              <div>
                <p className="text-sm text-text-main font-medium mb-1">Cloudflare Tunnel</p>
                <p className="text-sm text-text-muted">
                  Expose your local Pod to the internet. No port forwarding, no static IP needed. Share endpoint URL
                  with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <LucideIcon name={benefit.icon} className="text-xl text-primary mb-1" />
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.</p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => {
          if (!tsInstalling) {
            setShowTsModal(false);
            setTsSudoPassword("");
            setTsStatus(null);
          }
        }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <LucideIcon name="progress_activity" className="animate-spin text-sm" />
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
                  Install Tailscale
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <LucideIcon name="progress_activity" className="animate-spin text-sm" />
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div
                  ref={tsLogRef}
                  className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted"
                >
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mb-2">
                <LucideIcon name="check_circle" className="text-[16px]" />
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    const tab = window.open("", "tailscale_auth", "width=600,height=700");
                    if (tab) {
                      const doc = tab.document;
                      const body = doc.body || doc.createElement("body");
                      if (!doc.body) {
                        doc.documentElement?.appendChild(body);
                      }
                      body.replaceChildren();
                      const message = doc.createElement("p");
                      message.style.cssText = "font-family:sans-serif;text-align:center;margin-top:40px";
                      message.textContent = "Connecting to Tailscale...";
                      body.appendChild(message);
                    }
                    handleConnectTailscale(tab);
                  }}
                  fullWidth
                >
                  Connect
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Endpoint card for static provider URLs */
function EndpointValueCard({ title, icon, url, copyId, copied, onCopy }) {
  return (
    <Card title={title} icon={icon} className="h-full">
      <div className="flex items-center gap-2">
        <Input value={url} readOnly className="flex-1 font-mono text-sm" />
        <button onClick={() => onCopy(url, copyId)} className={ENDPOINT_ICON_BUTTON_CLASS} title={`Copy ${title} URL`}>
          <LucideIcon name={copied === copyId ? "check" : "content_copy"} size={16} />
        </button>
      </div>
    </Card>
  );
}

/** Reusable status alert */
function StatusAlert({ status, className = "" }) {
  // Render URLs in message as clickable links
  const renderMessage = (msg) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part) ? (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="underline font-medium">
          {part}
        </a>
      ) : (
        part
      ),
    );
  };

  return (
    <div
      className={`p-2 rounded text-sm ${className} ${
        status.type === "success"
          ? "bg-green-500/10 text-green-600 dark:text-green-400"
          : status.type === "warning"
            ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
            : status.type === "info"
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
      }`}
    >
      {renderMessage(status.message)}
    </div>
  );
}

/** Inline tooltip, Claude Code CLI style */
function Tooltip({ text }) {
  return (
    <span className="relative group inline-flex items-center">
      <LucideIcon name="help" className="text-[14px] text-text-muted cursor-help" />
      <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 z-50 w-64 rounded bg-gray-900 dark:bg-gray-800 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
        {text}
      </span>
    </span>
  );
}

/** Security warning banner with optional action link */
function SecurityWarning({ message, action }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
      <LucideIcon name="warning" className="text-[16px] shrink-0 mt-0.5" />
      <p className="text-xs flex-1">{message}</p>
      {action && (
        <a
          href={action.href}
          className="text-xs font-medium underline shrink-0 hover:opacity-80"
          onClick={
            action.href.startsWith("#")
              ? (e) => {
                  e.preventDefault();
                  document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
                }
              : undefined
          }
        >
          {action.label}
        </a>
      )}
    </div>
  );
}

APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};
