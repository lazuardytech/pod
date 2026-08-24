"use client";

import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardSkeleton,
  IconButton,
  Input,
  Modal,
  SegmentedControl,
  Toggle,
  Tooltip,
} from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";
import { mutateJsonWithOfflineQueue } from "@/shared/services/offlineMutationRequest";
import { cn } from "@/shared/utils/cn";

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}

type ApiKeyRecord = {
  id: string;
  name: string;
  key: string;
  isActive?: boolean;
  limitType?: string;
  requestsPerMinute?: number | null;
  concurrentRequests?: number | null;
  createdAt: string;
  lastAccessAt?: string | null;
};

type StatusBanner = { type: "success" | "error" | "warning" | "info"; message: string } | null;

type TunnelStatusPayload = {
  tunnel?: { settingsEnabled?: boolean; enabled?: boolean; tunnelUrl?: string };
  tailscale?: { settingsEnabled?: boolean; enabled?: boolean; tunnelUrl?: string };
  download?: { downloading?: boolean; progress?: number };
  error?: unknown;
};

type SettingsPayload = {
  requireApiKey?: boolean;
  requireLogin?: boolean;
  hasPassword?: boolean;
  tunnelDashboardAccess?: boolean;
  rtkEnabled?: boolean;
  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  headroomEnabled?: boolean;
  headroomUrl?: string;
  ponytailEnabled?: boolean;
  ponytailLevel?: string;
};

type ConfirmDialogState = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: (() => void) | null;
  variant: string;
};

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
const PONYTAIL_LEVELS = [
  { id: "lite", label: "Lite", desc: "Name the lazier alternative" },
  { id: "full", label: "Full", desc: "Stdlib first, shortest diff" },
  { id: "ultra", label: "Ultra", desc: "Deletion before addition" },
];
export default function APIPageClient({ machineId: _machineId }: { machineId: string }) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [editingKey, setEditingKey] = useState<ApiKeyRecord | null>(null);
  const [editKeyName, setEditKeyName] = useState("");
  const [keysPage, setKeysPage] = useState(1);
  const KEYS_PAGE_SIZE = 15;
  const [newKeyLimitType, setNewKeyLimitType] = useState("unlimited");
  const [newKeyRpm, setNewKeyRpm] = useState("60");
  const [newKeyConcurrent, setNewKeyConcurrent] = useState("5");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [requireApiKey, setRequireApiKey] = useState(true);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
  const [rtkEnabled, setRtkEnabledState] = useState(false);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomStatus, setHeadroomStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [headroomProc, setHeadroomProc] = useState<{
    installed?: boolean;
    running?: boolean;
    canStart?: boolean;
    localUrl?: boolean;
    managedPid?: number | null;
    version?: string | null;
  }>({});
  const [headroomBusy, setHeadroomBusy] = useState(false);
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");

  // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState<StatusBanner>(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState<StatusBanner>(null);
  const setTsError = (msg: string) => {
    if (typeof msg === "string" && msg.includes("exited with code")) {
      toast.error("Failed to start Tailscale");
    } else {
      setTsStatus({ type: "error", message: msg });
    }
  };
  const [tsInstalled, setTsInstalled] = useState<boolean | null>(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState<string[]>([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef<HTMLDivElement | null>(null);
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
  const [visibleKeys, setVisibleKeys] = useState(new Set<string>());

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    message: "",
    onConfirm: null,
    variant: "default",
  });
  const openConfirm = (
    title: string,
    message: string,
    onConfirm: (() => void) | null,
    variant: string = "default",
  ) => setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () =>
    setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }));

  const { copied, copy } = useCopyToClipboard();

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const applyTunnelStatus = useCallback((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const d = data as TunnelStatusPayload;

    const tEnabled = d.tunnel?.settingsEnabled ?? d.tunnel?.enabled ?? false;
    const tUrl = d.tunnel?.tunnelUrl || "";
    const tsEn = d.tailscale?.settingsEnabled ?? d.tailscale?.enabled ?? false;
    const tsUrlVal = d.tailscale?.tunnelUrl || "";
    const sig = `${tEnabled}|${tUrl}|${tsEn}|${tsUrlVal}`;

    if (sig === tunnelStatusSigRef.current) return;
    tunnelStatusSigRef.current = sig;

    setTunnelUrl((prev) => (prev === tUrl ? prev : tUrl));
    setTunnelEnabled((prev) => (prev === tEnabled ? prev : tEnabled));
    setTsUrl((prev) => (prev === tsUrlVal ? prev : tsUrlVal));
    setTsEnabled((prev) => (prev === tsEn ? prev : tsEn));
  }, []);

  const applySettingsData = useCallback((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const d = data as SettingsPayload;
    setRequireApiKey(d.requireApiKey !== false);
    setRequireLogin(d.requireLogin !== false);
    setHasPassword(d.hasPassword || false);
    setTunnelDashboardAccess(d.tunnelDashboardAccess || false);
    setRtkEnabledState(!!d.rtkEnabled);
    setCavemanEnabled(!!d.cavemanEnabled);
    setCavemanLevel(d.cavemanLevel || "full");
    setHeadroomEnabled(!!d.headroomEnabled);
    setHeadroomUrl(d.headroomUrl || "http://localhost:8787");
    setPonytailEnabled(!!d.ponytailEnabled);
    setPonytailLevel(d.ponytailLevel || "full");
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
    if (!shouldPollTunnelStatus) {
      return undefined;
    }

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/tunnel/status/stream");

      es.addEventListener("status", (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.error) return;
          applyTunnelStatus(payload);
        } catch {
          // ignore malformed event and keep stream alive
        }
      });

      es.onerror = () => {
        es?.close();
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
        const data = statusResult.data as TunnelStatusPayload;
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

  const handleTunnelDashboardAccess = async (value: boolean) => {
    const previous = tunnelDashboardAccess;
    setTunnelDashboardAccess(value);
    const result = await patchSetting(
      { tunnelDashboardAccess: value },
      { feature: "endpoint-tunnel-dashboard-access" },
    );
    if ("error" in result && result.error) {
      setTunnelDashboardAccess(previous);
    }
  };

  const handleRequireApiKey = async (value: boolean) => {
    const previous = requireApiKey;
    setRequireApiKey(value);
    const result = await patchSetting(
      { requireApiKey: value },
      { feature: "endpoint-require-api-key" },
    );
    if ("error" in result && result.error) {
      setRequireApiKey(previous);
    }
  };

  const handleRtkEnabled = async (value: boolean) => {
    const previous = rtkEnabled;
    setRtkEnabledState(value);
    const result = await patchSetting({ rtkEnabled: value }, { feature: "endpoint-rtk-enabled" });
    if ("error" in result && result.error) {
      setRtkEnabledState(previous);
    }
  };

  const patchSetting = async (
    patch: Record<string, unknown>,
    { feature = "endpoint-settings" }: { feature?: string } = {},
  ) => {
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

  const handleCavemanMode = (value: string) => {
    const previousEnabled = cavemanEnabled;
    const previousLevel = cavemanLevel;
    const enabled = value !== "off";
    const level = enabled ? value : previousLevel;
    setCavemanEnabled(enabled);
    if (enabled) setCavemanLevel(level);
    patchSetting(
      enabled ? { cavemanEnabled: true, cavemanLevel: level } : { cavemanEnabled: false },
      { feature: "endpoint-caveman-mode" },
    ).then((result) => {
      if ("error" in result && result.error) {
        setCavemanEnabled(previousEnabled);
        setCavemanLevel(previousLevel);
      }
    });
  };

  const handlePonytailMode = (value: string) => {
    const previousEnabled = ponytailEnabled;
    const previousLevel = ponytailLevel;
    const enabled = value !== "off";
    const level = enabled ? value : previousLevel;
    setPonytailEnabled(enabled);
    if (enabled) setPonytailLevel(level);
    patchSetting(
      enabled ? { ponytailEnabled: true, ponytailLevel: level } : { ponytailEnabled: false },
      { feature: "endpoint-ponytail-mode" },
    ).then((result) => {
      if ("error" in result && result.error) {
        setPonytailEnabled(previousEnabled);
        setPonytailLevel(previousLevel);
      }
    });
  };

  const probeHeadroom = useCallback(async () => {
    try {
      const res = await fetch("/api/headroom/health", { cache: "no-store" });
      if (!res.ok) {
        setHeadroomStatus("error");
        return;
      }
      const data = (await res.json()) as { ok?: boolean };
      setHeadroomStatus(data.ok ? "ok" : "error");
    } catch {
      setHeadroomStatus("error");
    }
  }, []);

  const refreshHeadroomProc = useCallback(async () => {
    try {
      const res = await fetch("/api/headroom/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as typeof headroomProc;
      setHeadroomProc(data);
    } catch {
      // status is advisory
    }
  }, []);

  const handleHeadroomSpawn = async (action: "start" | "stop" | "restart") => {
    setHeadroomBusy(true);
    try {
      const res = await fetch(`/api/headroom/${action}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : `Headroom ${action} failed`);
        return;
      }
      await refreshHeadroomProc();
      if (headroomEnabled) void probeHeadroom();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setHeadroomBusy(false);
    }
  };

  const handleHeadroomEnabled = async (value: boolean) => {
    const previous = headroomEnabled;
    setHeadroomEnabled(value);
    const result = await patchSetting(
      { headroomEnabled: value },
      { feature: "endpoint-headroom-enabled" },
    );
    if ("error" in result && result.error) {
      setHeadroomEnabled(previous);
      return;
    }
    if (value) void probeHeadroom();
    else setHeadroomStatus("unknown");
  };

  const handleHeadroomUrlBlur = async () => {
    const result = await patchSetting({ headroomUrl }, { feature: "endpoint-headroom-url" });
    if ("error" in result && result.error) {
      toast.error(typeof result.error === "string" ? result.error : "Invalid Headroom URL");
      return;
    }
    if (headroomEnabled) void probeHeadroom();
  };

  useEffect(() => {
    if (headroomEnabled) void probeHeadroom();
    void refreshHeadroomProc();
  }, [headroomEnabled, probeHeadroom, refreshHeadroomProc]);

  const fetchData = async () => {
    try {
      const result = await loadJsonStaleWhileRevalidate({
        url: "/api/keys",
        cacheKey: OFFLINE_KEYS_CACHE_KEY,
        maxStaleMs: OFFLINE_MAX_STALE_MS,
        cacheTags: ["api-keys"],
        onCacheData: (data) => {
          const payload = data as { keys?: ApiKeyRecord[] };
          setKeys(payload?.keys || []);
          setLoading(false);
        },
        onFreshData: (data) => {
          const payload = data as { keys?: ApiKeyRecord[] };
          setKeys(payload?.keys || []);
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
  const backgroundTunnelHealth = (url: string) => {
    if (!url) return;
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    const check = async () => {
      while (Date.now() - start < TUNNEL_PING_MAX_MS) {
        if (unmountRef.current) return;
        await new Promise<void>((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
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
      await new Promise<void>((r) => setTimeout(r, 1000));
      try {
        const r = await fetch("/api/tunnel/status");
        if (!r.ok) continue;
        const s = await r.json();

        // Show download progress
        if (s.download?.downloading) {
          const pct = s.download.progress;
          setTunnelProgress(
            pct < 100 ? `Downloading cloudflared... ${pct}%` : "Creating tunnel...",
          );
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

    setTunnelStatus({
      type: "error",
      message: "Tunnel creation timed out. Please check your network and try again.",
    });
    setTunnelLoading(false);
    setTunnelProgress("");
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: errMessage(error) });
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

      if (!res.body) throw new Error("No response body");
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
      setTsError(errMessage(e));
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url: string): Promise<boolean> => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      if (unmountRef.current) return false;
      await new Promise<void>((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch {
        /* not ready yet */
      }
    }
    return false;
  };

  const handleConnectTailscale = async (preOpenedTab?: Window | null) => {
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
          await new Promise<void>((r) => setTimeout(r, 3000));
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
      setTsError(errMessage(error));
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
    }
  };

  const pollFunnelEnable = async (enableUrl: string, tab: Window | null) => {
    if (tab) tab.location.href = enableUrl;
    else window.open(enableUrl, "tailscale_auth", "width=600,height=700");
    setTsProgress("Enable Funnel in browser, waiting...");
    for (let i = 0; i < 40; i++) {
      if (unmountRef.current) return;
      await new Promise<void>((r) => setTimeout(r, 3000));
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
      const data = (await res.json()) as { error?: string };
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsError(data.error || "Failed to disable Tailscale");
      }
    } catch (e) {
      setTsError(errMessage(e));
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
      const data = (await res.json()) as { key?: string };

      if (res.ok) {
        setCreatedKey(data.key || null);
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

  const handleDeleteKey = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys(keys.filter((k: ApiKeyRecord) => k.id !== id));
        setVisibleKeys((prev: Set<string>) => {
          const next = new Set<string>(prev);
          next.delete(id);
          return next;
        });
      }
    } catch (error) {
      console.error("Error deleting key:", error);
    }
  };

  const handleEditKey = (key: ApiKeyRecord) => {
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
        setKeys(
          keys.map((k: ApiKeyRecord) =>
            k.id === editingKey.id ? { ...k, name: editKeyName.trim() } : k,
          ),
        );
        setEditingKey(null);
        setEditKeyName("");
      }
    } catch (error) {
      console.error("Error updating key:", error);
    }
  };

  const handleToggleKey = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys((prev) => prev.map((k: ApiKeyRecord) => (k.id === id ? { ...k, isActive } : k)));
      }
    } catch (error) {
      console.error("Error toggling key:", error);
    }
  };

  const maskKey = (fullKey: string) => {
    if (!fullKey) return "";
    return fullKey.length > 24 ? `${fullKey.slice(0, 24)}...` : fullKey;
  };

  const toggleKeyVisibility = (keyId: string) => {
    setVisibleKeys((prev: Set<string>) => {
      const next = new Set<string>(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const [baseUrl, setBaseUrl] = useState("");
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

  const currentEndpoint = baseUrl || "Processing...";
  const endpointReady = Boolean(baseUrl);
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
          ready={endpointReady}
        />
        <EndpointValueCard
          title="Anthropic"
          icon="api"
          url={currentEndpoint}
          copyId="anthropic_url"
          copied={copied}
          onCopy={copy}
          ready={endpointReady}
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
                      message:
                        'Security required: Enable "Require API key" before activating the tunnel.',
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
                <IconButton
                  size="lg"
                  icon={copied === "tunnel_url" ? "check" : "content_copy"}
                  onClick={() => copy(`${tunnelUrl}/v1`, "tunnel_url")}
                  className={ENDPOINT_ICON_BUTTON_CLASS}
                  title="Copy tunnel URL"
                />
                <IconButton
                  size="lg"
                  icon="power_settings_new"
                  onClick={() => setShowDisableTunnelModal(true)}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Disable Tunnel"
                />
              </div>
            ) : tunnelLoading ? (
              <div className="flex items-start gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-[6px] border border-charcoal-grey bg-pitch-black px-3 py-2 text-sm text-storm-cloud">
                  <LucideIcon
                    name="progress_activity"
                    size={14}
                    className="animate-spin shrink-0"
                  />
                  <span>{tunnelProgress || "Creating tunnel..."}</span>
                </div>
                <IconButton
                  size="lg"
                  icon="power_settings_new"
                  onClick={() => {
                    setTunnelLoading(false);
                    setTunnelProgress("");
                  }}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Stop"
                />
              </div>
            ) : tunnelStatus?.type === "error" ? (
              <div className="flex items-start gap-2 rounded-[6px] border border-warning-red/25 bg-warning-red/8 px-3 py-2 text-sm text-warning-red">
                <LucideIcon name="error" size={14} className="mt-0.5 shrink-0" />
                <span>{tunnelStatus.message}</span>
              </div>
            ) : tunnelChecking ? (
              <div className="flex items-start gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-[6px] border border-charcoal-grey bg-pitch-black px-3 py-2 text-sm text-storm-cloud">
                  <LucideIcon
                    name="progress_activity"
                    size={14}
                    className="animate-spin shrink-0"
                  />
                  <span>Checking...</span>
                </div>
                <IconButton
                  size="lg"
                  icon="power_settings_new"
                  onClick={() => setTunnelChecking(false)}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Stop"
                />
              </div>
            ) : (
              <p className="text-sm text-storm-cloud">
                Expose your local Pod API with a secure public endpoint.
              </p>
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
                <IconButton
                  size="lg"
                  icon={copied === "ts_url" ? "check" : "content_copy"}
                  onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                  className={ENDPOINT_ICON_BUTTON_CLASS}
                  title="Copy Tailscale URL"
                />
                <IconButton
                  size="lg"
                  icon="power_settings_new"
                  onClick={() => setShowDisableTsModal(true)}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Disable Tailscale"
                />
              </div>
            ) : tsLoading || tsConnecting ? (
              <div className="flex items-start gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-[6px] border border-charcoal-grey bg-pitch-black px-3 py-2 text-sm text-storm-cloud">
                  <LucideIcon
                    name="progress_activity"
                    size={14}
                    className="animate-spin shrink-0"
                  />
                  <span>{tsProgress || "Connecting..."}</span>
                </div>
                <IconButton
                  size="lg"
                  icon="power_settings_new"
                  onClick={() => {
                    setTsLoading(false);
                    setTsConnecting(false);
                    setTsProgress("");
                  }}
                  className={ENDPOINT_DANGER_BUTTON_CLASS}
                  title="Stop"
                />
              </div>
            ) : tsStatus?.type === "error" ? (
              <div className="flex items-start gap-2 rounded-[6px] border border-warning-red/25 bg-warning-red/8 px-3 py-2 text-sm text-warning-red">
                <LucideIcon name="error" size={14} className="mt-0.5 shrink-0" />
                <span>{tsStatus.message}</span>
              </div>
            ) : (
              <p className="text-sm text-storm-cloud">
                Make Pod reachable on your private Tailscale network.
              </p>
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
                <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked.">
                  <LucideIcon name="help" className="text-[14px] text-text-muted cursor-help" />
                </Tooltip>
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
            <p className="text-sm text-text-muted">
              git/grep/ls/tree/logs → 60-90% fewer input tokens
            </p>
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
            <p className="text-sm text-text-muted">
              Terse-style system prompt → ~65% fewer output tokens (up to 87%)
            </p>
          </div>
          <SegmentedControl
            size="sm"
            className="shrink-0"
            aria-label="Caveman compression mode"
            value={cavemanEnabled ? cavemanLevel : "off"}
            onChange={handleCavemanMode}
            options={[
              { value: "off", label: "Off" },
              ...CAVEMAN_LEVELS.map((lvl) => ({ value: lvl.id, label: lvl.label })),
            ]}
          />
        </div>
        <div className="flex items-center justify-between pt-4 border-t border-border mt-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Lazy senior dev{" "}
              <a
                href="https://github.com/DietrichGebert/ponytail"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Ponytail)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Inject a shortest-diff system prompt on each request (not Cursor /ponytail skills)
            </p>
          </div>
          <SegmentedControl
            size="sm"
            className="shrink-0"
            aria-label="Ponytail compression mode"
            value={ponytailEnabled ? ponytailLevel : "off"}
            onChange={handlePonytailMode}
            options={[
              { value: "off", label: "Off" },
              ...PONYTAIL_LEVELS.map((lvl) => ({ value: lvl.id, label: lvl.label })),
            ]}
          />
        </div>
        <div className="flex flex-col gap-3 pt-4 border-t border-border mt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Compress context{" "}
                <span className="text-xs font-normal text-text-muted">(Headroom)</span>
              </p>
              <p className="text-sm text-text-muted">
                POST to Headroom /v1/compress before routing. Fail-open if unreachable.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant={
                  !headroomEnabled ? "default" : headroomStatus === "ok" ? "success" : "warning"
                }
              >
                {!headroomEnabled
                  ? "Off"
                  : headroomStatus === "ok"
                    ? "Reachable"
                    : headroomStatus === "error"
                      ? "Unreachable"
                      : "Unknown"}
              </Badge>
              <Toggle
                checked={headroomEnabled}
                onChange={() => handleHeadroomEnabled(!headroomEnabled)}
              />
            </div>
          </div>
          <Input
            label="Headroom URL"
            value={headroomUrl}
            onChange={(e) => setHeadroomUrl(e.target.value)}
            onBlur={() => void handleHeadroomUrlBlur()}
            placeholder="http://localhost:8787"
            hint="localhost, 127.0.0.1, or hostname headroom only"
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-text-muted flex-1 min-w-[12rem]">
              {headroomProc.installed
                ? `CLI ${headroomProc.version || "installed"}${
                    headroomProc.running && headroomProc.managedPid
                      ? ` · running pid ${headroomProc.managedPid}`
                      : headroomProc.running
                        ? " · running"
                        : " · stopped"
                  }`
                : "Local Python CLI not on PATH — spawn is local-only (no Docker/Zeabur sidecar)"}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={headroomBusy || !headroomProc.canStart || headroomProc.running}
              onClick={() => void handleHeadroomSpawn("start")}
            >
              Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={headroomBusy || !headroomProc.running}
              onClick={() => void handleHeadroomSpawn("stop")}
            >
              Stop
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={headroomBusy || !headroomProc.canStart}
              onClick={() => void handleHeadroomSpawn("restart")}
            >
              Restart
            </Button>
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
            {[1, 2, 3].map((i: number) => (
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
                  {keys
                    .slice((keysPage - 1) * KEYS_PAGE_SIZE, keysPage * KEYS_PAGE_SIZE)
                    .map((key: ApiKeyRecord) => (
                      <tr
                        key={key.id}
                        className={`group border-b border-charcoal-grey/50 last:border-0 hover:bg-deep-slate transition-colors duration-100 ${
                          key.isActive === false ? "opacity-60" : ""
                        }`}
                      >
                        {/* Name */}
                        <td className="px-3 py-2 border-r border-charcoal-grey/50">
                          <span className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]">
                            {key.name}
                          </span>
                        </td>

                        {/* Key */}
                        <td className="px-3 py-2 border-r border-charcoal-grey/50">
                          <div className="flex items-center gap-1.5">
                            <code className="text-[11px] text-storm-cloud font-mono">
                              {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                            </code>
                            <IconButton
                              size="sm"
                              icon={visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                              onClick={() => toggleKeyVisibility(key.id)}
                              title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                              className="opacity-0 group-hover:opacity-100 rounded-[3px] text-fog-grey hover:text-porcelain hover:bg-charcoal-grey"
                            />
                            <IconButton
                              size="sm"
                              icon={copied === key.id ? "check" : "content_copy"}
                              onClick={() => copy(key.key, key.id)}
                              title="Copy key"
                              className="opacity-0 group-hover:opacity-100 rounded-[3px] text-fog-grey hover:text-porcelain hover:bg-charcoal-grey"
                            />
                          </div>
                        </td>

                        {/* Limit */}
                        <td className="px-3 py-2 border-r border-charcoal-grey/50">
                          {key.limitType === "limited" ? (
                            <span className="text-[11px] text-aether-blue">
                              {key.requestsPerMinute || 0} req/min · {key.concurrentRequests || 0}{" "}
                              concurrent
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
                              onChange={(checked: boolean) => {
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
                            <IconButton
                              size="sm"
                              icon="edit"
                              onClick={() => handleEditKey(key)}
                              title="Edit key"
                              className="size-6 rounded-[4px] text-fog-grey hover:bg-deep-slate hover:text-porcelain"
                            />
                            <IconButton
                              size="sm"
                              icon="delete"
                              onClick={() =>
                                openConfirm(
                                  "Delete API Key",
                                  "Are you sure you want to delete this API key? This action cannot be undone.",
                                  () => handleDeleteKey(key.id),
                                  "danger",
                                )
                              }
                              title="Delete key"
                              className="size-6 rounded-[4px] text-fog-grey hover:bg-warning-red/10 hover:text-warning-red"
                            />
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
                  {(keysPage - 1) * KEYS_PAGE_SIZE + 1}–
                  {Math.min(keysPage * KEYS_PAGE_SIZE, keys.length)} of {keys.length}
                </span>
                <div className="flex items-center gap-1">
                  <IconButton
                    size="sm"
                    icon="chevron_left"
                    onClick={() => setKeysPage((p: number) => Math.max(1, p - 1))}
                    disabled={keysPage === 1}
                    title="Previous page"
                    className="size-6 rounded-[4px] border border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain disabled:opacity-40"
                  />
                  {Array.from(
                    { length: Math.ceil(keys.length / KEYS_PAGE_SIZE) },
                    (_: unknown, i: number) => i + 1,
                  ).map((p: number) => (
                    <Button
                      key={p}
                      variant="ghost"
                      size="sm"
                      onClick={() => setKeysPage(p)}
                      className={cn(
                        "size-6 min-w-6 rounded-[4px] p-0 text-[11px] font-[510]",
                        p === keysPage
                          ? "bg-porcelain/10 text-porcelain border border-porcelain/20"
                          : "text-fog-grey hover:bg-deep-slate hover:text-porcelain border border-transparent",
                      )}
                    >
                      {p}
                    </Button>
                  ))}
                  <IconButton
                    size="sm"
                    icon="chevron_right"
                    onClick={() =>
                      setKeysPage((p: number) =>
                        Math.min(Math.ceil(keys.length / KEYS_PAGE_SIZE), p + 1),
                      )
                    }
                    disabled={keysPage === Math.ceil(keys.length / KEYS_PAGE_SIZE)}
                    title="Next page"
                    className="size-6 rounded-[4px] border border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain disabled:opacity-40"
                  />
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
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-main">Limit Type</label>
            <SegmentedControl
              value={newKeyLimitType}
              onChange={(v: string) => setNewKeyLimitType(v)}
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewKeyRpm(e.target.value)}
                placeholder="60"
              />
              <Input
                label="Concurrent Request"
                type="number"
                min={1}
                step={1}
                value={newKeyConcurrent}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewKeyConcurrent(e.target.value)}
                placeholder="5"
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              onClick={handleCreateKey}
              fullWidth
              disabled={!newKeyName.trim() || !hasValidCreateRateLimitInputs}
            >
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
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEditKeyName(e.target.value)}
          placeholder="Production Key"
          autoFocus
        />
      </Modal>

      {/* Created Key Modal */}
      <Modal isOpen={!!createdKey} title="API Key Created" onClose={() => setCreatedKey(null)}>
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2 items-end">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1"
              inputClassName="font-mono text-sm"
            />
            <Button
              size="lg"
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey || "", "created_key")}
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
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <LucideIcon name="cloud_upload" className="text-primary" />
              <div>
                <p className="text-sm text-text-main font-medium mb-1">Cloudflare Tunnel</p>
                <p className="text-sm text-text-muted">
                  Expose your local Pod to the internet. No port forwarding, no static IP needed.
                  Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools
                  from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50"
              >
                <LucideIcon name={benefit.icon} className="text-xl text-primary mb-1" />
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

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
            The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop
            working.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={handleDisableTunnel}
              fullWidth
              disabled={tunnelLoading}
              variant="danger"
            >
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button
              onClick={() => setShowDisableTunnelModal(false)}
              variant="ghost"
              fullWidth
              disabled={tunnelLoading}
            >
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
              <p className="text-sm text-text-muted">
                Tailscale is not installed. Install it to enable Funnel.
              </p>
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
                  {tsInstallLog.map((line: string, i: number) => (
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
                      message.style.cssText =
                        "font-family:sans-serif;text-align:center;margin-top:40px";
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
            <Button
              onClick={handleDisableTailscale}
              fullWidth
              disabled={tsLoading}
              variant="danger"
            >
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button
              onClick={() => setShowDisableTsModal(false)}
              variant="ghost"
              fullWidth
              disabled={tsLoading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Endpoint card for static provider URLs */
function EndpointValueCard({
  title,
  icon,
  url,
  copyId,
  copied,
  onCopy,
  ready = true,
}: {
  title: string;
  icon: string;
  url: string;
  copyId: string;
  copied: string | null;
  onCopy: (text: string, id?: string) => void;
  ready?: boolean;
}) {
  return (
    <Card title={title} icon={icon} className="h-full">
      <div className="flex items-center gap-2">
        <Input
          value={url}
          readOnly
          className={cn("flex-1 font-mono text-sm", !ready && "text-storm-cloud")}
        />
        <IconButton
          size="lg"
          icon={copied === copyId ? "check" : "content_copy"}
          onClick={() => onCopy(url, copyId)}
          disabled={!ready}
          className={cn(ENDPOINT_ICON_BUTTON_CLASS, !ready && "opacity-40 pointer-events-none")}
          title={`Copy ${title} URL`}
        />
      </div>
    </Card>
  );
}

/** Reusable status alert */
function StatusAlert({
  status,
  className = "",
}: {
  status: NonNullable<StatusBanner>;
  className?: string;
}) {
  // Render URLs in message as clickable links
  const renderMessage = (msg: string) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part: string, i: number) =>
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

/** Security warning banner with optional action link */
function SecurityWarning({
  message,
  action,
}: {
  message: string;
  action?: { label: string; href: string };
}) {
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
              ? (e: MouseEvent<HTMLAnchorElement>) => {
                  e.preventDefault();
                  document
                    .getElementById(action.href.slice(1))
                    ?.scrollIntoView({ behavior: "smooth" });
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
