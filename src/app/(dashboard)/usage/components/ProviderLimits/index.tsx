"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { EditConnectionModal } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Toggle from "@/shared/components/Toggle";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { cn } from "@/shared/utils/cn";
import { calculatePercentage, formatResetTime, getStatusColor, parseQuotaData } from "./utils";

// Connection is eligible for the quota page when it uses OAuth or is an apikey provider whitelisted for quota
const isUsageEligible = (conn: UsageConnection): boolean =>
  USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) &&
  (conn.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(conn.provider));

const DEPLETED_QUOTA_THRESHOLD = 5; // percent
const AUTO_REFRESH_STORAGE_KEY = "quotaAutoRefresh";
const QUOTA_CACHE_KEY = "providerQuotaCache";
const QUOTA_CACHE_TTL_MS = 300000; // 5 minutes cache TTL
const COLLAPSE_ALL_STORAGE_KEY = "quotaCollapseAll";
const EXPIRING_FIRST_STORAGE_KEY = "quotaExpiringFirst";
const HIDE_DISABLED_STORAGE_KEY = "quotaHideDisabled";

const readLocalBool = (key: string): boolean => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "true";
};

type QuotaItem = {
  name?: string;
  modelKey?: string;
  used?: number;
  total?: number;
  resetAt?: string | null;
  remainingPercentage?: number;
  message?: string;
};

type QuotaConnectionData = {
  quotas?: QuotaItem[];
  message?: string | null;
  plan?: string | null;
  raw?: unknown;
};

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}

type UsageConnection = {
  id: string;
  provider: string;
  authType?: string;
  isActive?: boolean;
  email?: string;
  name?: string;
  lastUsedAt?: string | null;
};

type QuotaSnapshot = {
  connections?: UsageConnection[];
  quotaData?: Record<string, QuotaConnectionData>;
  errors?: Record<string, string | null>;
};

type ConfirmDialogState = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: (() => void) | null;
  variant: string;
};

type ProxyPool = { id: string; name?: string; [key: string]: unknown };

export default function ProviderLimits() {
  const [connections, setConnections] = useState<UsageConnection[]>([]);
  const [quotaData, setQuotaData] = useState<Record<string, QuotaConnectionData>>(() => {
    if (typeof window === "undefined") return {};
    const cached = window.localStorage.getItem(QUOTA_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        data: Record<string, QuotaConnectionData>;
        timestamp: number;
      };
      if (Date.now() - parsed.timestamp < QUOTA_CACHE_TTL_MS) return parsed.data;
    }
    return {};
  });
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [autoRefresh, setAutoRefresh] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });
  const [_lastUpdated, setLastUpdated] = useState<Date | null>(() => {
    if (typeof window === "undefined") return null;
    const cached = window.localStorage.getItem(QUOTA_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { timestamp: number };
      if (Date.now() - parsed.timestamp < QUOTA_CACHE_TTL_MS) return new Date(parsed.timestamp);
    }
    return null;
  });
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<UsageConnection | null>(null);
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
  const [providerFilter, setProviderFilter] = useState("all");
  const [expiringFirst, setExpiringFirst] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [bulkToggling, setBulkToggling] = useState(false);
  const [collapseAll, setCollapseAll] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [hideDisabled, setHideDisabled] = useState(false);
  const [disabledModels, setDisabledModels] = useState<Record<string, string[]>>({});

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

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshingAllRef = useRef(false);

  // Hydrate toggle states from localStorage after mount (avoids SSR/hydration mismatch)
  useEffect(() => {
    const collapse = readLocalBool(COLLAPSE_ALL_STORAGE_KEY);
    const expiring = readLocalBool(EXPIRING_FIRST_STORAGE_KEY);
    const hide = readLocalBool(HIDE_DISABLED_STORAGE_KEY);
    if (collapse) {
      setCollapseAll(true);
      setExpandedRows({ __collapsed: true });
      setExpandedProviders({ __collapsed: true });
    }
    if (expiring) setExpiringFirst(true);
    if (hide) setHideDisabled(true);
  }, []);

  // Sync cache
  useEffect(() => {
    if (Object.keys(quotaData).length > 0) {
      window.localStorage.setItem(
        QUOTA_CACHE_KEY,
        JSON.stringify({ data: quotaData, timestamp: Date.now() }),
      );
    }
  }, [quotaData]);

  // Fetch disabled models
  useEffect(() => {
    fetch("/api/models/disabled")
      .then((res: Response) => res.json())
      .then(
        (
          data: { error?: unknown; disabled?: Record<string, string[]> } & Record<string, string[]>,
        ) => {
          if (data && typeof data === "object" && !data.error) {
            setDisabledModels(data.disabled || data);
          }
        },
      )
      .catch(() => {});
  }, []);

  // Fetch all provider connections
  const fetchConnections = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/client");
      if (!response.ok) throw new Error("Failed to fetch connections");

      const data = (await response.json()) as { connections?: UsageConnection[] };
      const connectionList: UsageConnection[] = data.connections || [];
      setConnections(connectionList);
      return connectionList;
    } catch (error) {
      console.error("Error fetching connections:", error);
      setConnections([]);
      return [];
    }
  }, []);

  // Fetch quota for a specific connection
  const fetchQuota = useCallback(async (connectionId: string, provider: string) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      const response = await fetch(`/api/usage/${connectionId}`);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        const errorMsg = errorData.error || response.statusText;

        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn("[ProviderLimits] Connection not found, skipping");
          return;
        }

        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn("[ProviderLimits] Auth error while fetching quota");
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: {
              quotas: [],
              message: errorMsg,
            },
          }));
          return;
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = (await response.json()) as {
        plan?: string | null;
        message?: string | null;
        [key: string]: unknown;
      };
      // Parse quota data using provider-specific parser
      const parsedQuotas = parseQuotaData(provider, data) as QuotaItem[];

      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: {
          quotas: parsedQuotas,
          plan: data.plan || null,
          message: data.message || null,
          raw: data,
        } satisfies QuotaConnectionData,
      }));
    } catch (error) {
      console.error("[ProviderLimits] Error fetching quota");
      setErrors((prev) => ({
        ...prev,
        [connectionId]: errMessage(error) || "Failed to fetch quota",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  // Refresh quota for a specific provider
  const refreshProvider = useCallback(
    async (connectionId: string, provider: string) => {
      await fetchQuota(connectionId, provider);
      setLastUpdated(new Date());
    },
    [fetchQuota],
  );

  const applySnapshot = useCallback((snapshot: QuotaSnapshot) => {
    if (!snapshot || typeof snapshot !== "object") return;
    if (Array.isArray(snapshot.connections)) setConnections(snapshot.connections);
    if (snapshot.quotaData && typeof snapshot.quotaData === "object") {
      setQuotaData(snapshot.quotaData);
      setLoading({});
    }
    if (snapshot.errors && typeof snapshot.errors === "object") {
      setErrors(snapshot.errors);
    } else {
      setErrors({});
    }
    setConnectionsLoading(false);
    setLastUpdated(new Date());
    setCountdown(60);
  }, []);

  const handleDeleteConnection = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections((prev) => prev.filter((c: UsageConnection) => c.id !== id));
        setQuotaData((prev) => {
          const next: Record<string, QuotaConnectionData> = { ...prev };
          delete next[id];
          return next;
        });
        setLoading((prev) => {
          const next: Record<string, boolean> = { ...prev };
          delete next[id];
          return next;
        });
        setErrors((prev) => {
          const next: Record<string, string | null> = { ...prev };
          delete next[id];
          return next;
        });
      }
    } catch (error) {
      console.error("Error deleting connection:", error);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleToggleConnectionActive = useCallback(async (id: string, isActive: boolean) => {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections((prev) =>
          prev.map((c: UsageConnection) => (c.id === id ? { ...c, isActive } : c)),
        );
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    } finally {
      setTogglingId(null);
    }
  }, []);

  const handleUpdateConnection = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!selectedConnection?.id) return;
      const connectionId = selectedConnection.id;
      const provider = selectedConnection.provider;
      try {
        const res = await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (res.ok) {
          await fetchConnections();
          setShowEditModal(false);
          setSelectedConnection(null);
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
            await fetchQuota(connectionId, provider);
          }
        }
      } catch (error) {
        console.error("Error saving connection:", error);
      }
    },
    [selectedConnection, fetchConnections, fetchQuota],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((res: Response) => res.json())
      .then((data: { proxyPools?: ProxyPool[] }) => {
        if (!cancelled && data?.proxyPools) {
          setProxyPools(data.proxyPools);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh all providers
  const refreshAll = useCallback(async () => {
    if (refreshingAllRef.current) return;

    refreshingAllRef.current = true;
    setRefreshingAll(true);
    setCountdown(60);

    try {
      const conns = await fetchConnections();

      // Filter eligible connections (OAuth + whitelisted apikey)
      const eligibleConnections = (conns as UsageConnection[]).filter(isUsageEligible);

      await Promise.all(
        eligibleConnections.map((conn: UsageConnection) => fetchQuota(conn.id, conn.provider)),
      );

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error refreshing all providers:", error);
    } finally {
      refreshingAllRef.current = false;
      setRefreshingAll(false);
    }
  }, [fetchConnections, fetchQuota]);

  // Initial load: fetch connections first so cards render immediately, then fetch quotas
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const initializeData = async () => {
      setConnectionsLoading(true);
      const conns = await fetchConnections();
      setConnectionsLoading(false);

      const eligibleConnections = conns.filter(isUsageEligible);

      // Mark all as loading before fetching
      const loadingState: Record<string, boolean> = {};
      eligibleConnections.forEach((conn: UsageConnection) => {
        loadingState[conn.id] = true;
      });
      setLoading(loadingState);

      await Promise.all(
        eligibleConnections.map((conn: UsageConnection) => fetchQuota(conn.id, conn.provider)),
      );
      setLastUpdated(new Date());
    };

    initializeData();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Persist auto-refresh preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
  }, [autoRefresh]);

  // Persist toggle states to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EXPIRING_FIRST_STORAGE_KEY, String(expiringFirst));
  }, [expiringFirst]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSE_ALL_STORAGE_KEY, String(collapseAll));
  }, [collapseAll]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HIDE_DISABLED_STORAGE_KEY, String(hideDisabled));
  }, [hideDisabled]);

  // Live updates via SSE stream (replaces polling interval)
  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/usage/provider-limits/stream");

      es.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data) as QuotaSnapshot & { error?: unknown };
          if (payload?.error) return;
          applySnapshot(payload);
        } catch {
          // keep stream alive on malformed chunk
        }
      };

      es.onerror = () => {
        es?.close();
        refreshAll().catch(() => {});
        if (!closed) reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [applySnapshot, autoRefresh, refreshAll]);

  // Countdown indicator for live mode
  useEffect(() => {
    if (!autoRefresh) {
      setCountdown(60);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return undefined;
    }

    countdownRef.current = setInterval(() => {
      setCountdown((prev: number) => (prev <= 1 ? 60 : prev - 1));
    }, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [autoRefresh]);

  // Filter eligible connections (OAuth + whitelisted apikey)
  const filteredConnections = connections.filter(isUsageEligible);

  const providerFilteredConnections = filteredConnections.filter(
    (conn: UsageConnection) => providerFilter === "all" || conn.provider === providerFilter,
  );

  const getEarliestResetTime = (conn: UsageConnection): number => {
    const resetTimes = (quotaData[conn.id]?.quotas || [])
      .map((quota: QuotaItem) =>
        quota.resetAt ? new Date(quota.resetAt).getTime() : Number.POSITIVE_INFINITY,
      )
      .filter((time: number) => Number.isFinite(time));
    return resetTimes.length > 0 ? Math.min(...resetTimes) : Number.POSITIVE_INFINITY;
  };

  // Sort providers by USAGE_SUPPORTED_PROVIDERS order, then alphabetically.
  // Optionally surface accounts with quotas expiring soonest first.
  // Always hide connections that are disabled (isActive === false).
  const sortedConnections = [...providerFilteredConnections]
    .filter((conn: UsageConnection) => !hideDisabled || conn.isActive !== false)
    .sort((a: UsageConnection, b: UsageConnection) => {
      if (expiringFirst) {
        const expiryDiff = getEarliestResetTime(a) - getEarliestResetTime(b);
        if (expiryDiff !== 0) return expiryDiff;
      }
      const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
      const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });

  // Connection is depleted when any quota entry hit the threshold
  const isConnectionDepleted = (conn: UsageConnection): boolean => {
    const quotas = quotaData[conn.id]?.quotas;
    if (!quotas?.length) return false;
    return quotas.some((q: QuotaItem) => {
      if (!q.total || q.total <= 0) return false;
      return calculatePercentage(q.used, q.total) <= DEPLETED_QUOTA_THRESHOLD;
    });
  };

  const bulkSetActive = useCallback(
    async (targetIds: string[], isActive: boolean) => {
      if (!targetIds.length || bulkToggling) return;
      setBulkToggling(true);
      try {
        await Promise.all(
          targetIds.map((id: string) =>
            fetch(`/api/providers/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive }),
            }),
          ),
        );
        setConnections((prev) =>
          prev.map((c: UsageConnection) => (targetIds.includes(c.id) ? { ...c, isActive } : c)),
        );
      } catch (error) {
        console.error("Error bulk toggling connections:", error);
      } finally {
        setBulkToggling(false);
      }
    },
    [bulkToggling],
  );

  const handleDisableDepleted = () => {
    const ids = sortedConnections
      .filter((c: UsageConnection) => (c.isActive ?? true) && isConnectionDepleted(c))
      .map((c: UsageConnection) => c.id);
    bulkSetActive(ids, false);
  };

  const handleEnableAvailable = () => {
    const ids = sortedConnections
      .filter((c: UsageConnection) => !(c.isActive ?? true) && !isConnectionDepleted(c))
      .map((c: UsageConnection) => c.id);
    bulkSetActive(ids, true);
  };

  const providerOptions = Array.from(
    new Set<string>(filteredConnections.map((conn: UsageConnection) => conn.provider)),
  ).sort();
  const selectedProviderLabel = providerFilter === "all" ? "All providers" : providerFilter;

  // Calculate summary stats
  const _totalProviders = sortedConnections.length;
  const _activeWithLimits = Object.values(quotaData).filter(
    (data: QuotaConnectionData) => (data?.quotas?.length ?? 0) > 0,
  ).length;

  // Count low quotas (remaining < 30%)
  const _lowQuotasCount = Object.values(quotaData).reduce(
    (count: number, data: QuotaConnectionData) => {
      if (!data?.quotas) return count;

      const hasLowQuota = data.quotas.some((quota: QuotaItem) => {
        const percentage = calculatePercentage(quota.used, quota.total);
        return percentage < 30 && (quota.total ?? 0) > 0;
      });

      return count + (hasLowQuota ? 1 : 0);
    },
    0,
  );

  // Accumulated progress for a connection: sum used / sum total (enabled models only)
  const getAccumulatedProgress = (conn: UsageConnection) => {
    const quotas = quotaData[conn.id]?.quotas || [];
    const providerAlias = conn.provider;
    const disabledSet = new Set<string>(disabledModels[providerAlias] || []);
    const enabledQuotas = quotas.filter((q: QuotaItem) => {
      const key = q.modelKey || q.name;
      return typeof key === "string" && !disabledSet.has(key);
    });
    const totalUsed = enabledQuotas.reduce((s: number, q: QuotaItem) => s + (q.used || 0), 0);
    const totalLimit = enabledQuotas.reduce((s: number, q: QuotaItem) => s + (q.total || 0), 0);
    const pct = calculatePercentage(totalUsed, totalLimit);
    return { totalUsed, totalLimit, pct };
  };

  // Color classes from status color name
  const colorClasses = (color: string) => {
    if (color === "green")
      return { bar: "bg-green-500", track: "bg-green-500/15", text: "text-green-400" };
    if (color === "yellow")
      return { bar: "bg-yellow-500", track: "bg-yellow-500/15", text: "text-yellow-400" };
    return { bar: "bg-red-500", track: "bg-red-500/15", text: "text-red-400" };
  };

  // Empty state
  if (!connectionsLoading && sortedConnections.length === 0) {
    return (
      <div className="rounded-[6px] border border-charcoal-grey overflow-hidden">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <LucideIcon name="cloud_off" className="text-[48px] text-storm-cloud opacity-30" />
          <h3 className="mt-3 text-[13px] font-[510] text-porcelain">No Providers Connected</h3>
          <p className="mt-1 text-[11px] text-storm-cloud max-w-xs mx-auto">
            Connect to providers with OAuth to track your API quota limits and usage.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Provider filter */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProviderMenuOpen((prev: boolean) => !prev)}
            className="h-7 px-2.5 rounded-[4px] border border-charcoal-grey text-[11px] text-storm-cloud hover:text-porcelain hover:bg-deep-slate transition-colors flex items-center gap-1.5"
            aria-haspopup="menu"
            aria-expanded={providerMenuOpen}
            title="Filter quota providers"
          >
            {providerFilter === "all" ? (
              <LucideIcon name="apps" className="text-[13px]" />
            ) : (
              <ProviderIcon
                src={`/providers/${providerFilter}.png`}
                alt={providerFilter}
                size={14}
                className="size-[14px] rounded object-contain"
                fallbackText={providerFilter.slice(0, 2).toUpperCase()}
              />
            )}
            <span className="capitalize hidden lg:inline">{selectedProviderLabel}</span>
            <LucideIcon name="expand_more" className="text-[13px]" />
          </button>

          {providerMenuOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 bg-transparent"
                aria-label="Close provider filter"
                onClick={() => setProviderMenuOpen(false)}
              />
              <div className="absolute left-0 z-40 mt-1 w-52 overflow-hidden rounded-[6px] border border-charcoal-grey bg-graphite p-1 shadow-xl shadow-black/30">
                <button
                  type="button"
                  onClick={() => {
                    setProviderFilter("all");
                    setProviderMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    providerFilter === "all"
                      ? "bg-deep-slate text-porcelain"
                      : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain"
                  }`}
                >
                  <LucideIcon name="apps" className="text-[14px]" />
                  <span>All providers</span>
                  {providerFilter === "all" && (
                    <LucideIcon name="check" className="ml-auto text-[13px]" />
                  )}
                </button>
                <div className="my-1 h-px bg-charcoal-grey" />
                <div className="max-h-60 overflow-y-auto">
                  {providerOptions.map((provider: string) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => {
                        setProviderFilter(provider);
                        setProviderMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                        providerFilter === provider
                          ? "bg-deep-slate text-porcelain"
                          : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain"
                      }`}
                    >
                      <ProviderIcon
                        src={`/providers/${provider}.png`}
                        alt={provider}
                        size={16}
                        className="size-4 rounded object-contain"
                        fallbackText={provider.slice(0, 2).toUpperCase()}
                      />
                      <span className="capitalize">{provider}</span>
                      {providerFilter === provider && (
                        <LucideIcon name="check" className="ml-auto text-[13px]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Collapse All */}
        <button
          type="button"
          onClick={() => {
            const next = !collapseAll;
            setCollapseAll(next);
            if (next) {
              const allProviderKeys = sortedConnections.map((c: UsageConnection) => c.provider);
              const allConnIds = sortedConnections.map((c: UsageConnection) => c.id);
              setExpandedProviders(
                Object.fromEntries(allProviderKeys.map((k: string) => [k, false])),
              );
              setExpandedRows(Object.fromEntries(allConnIds.map((id: string) => [id, false])));
            } else {
              setExpandedProviders({});
              setExpandedRows({});
            }
          }}
          className={cn(
            "h-7 px-2.5 rounded-[4px] border text-[11px] transition-colors flex items-center gap-1",
            collapseAll
              ? "border-white/20 bg-white/8 text-white hover:bg-white/15"
              : "border-charcoal-grey text-storm-cloud hover:text-porcelain hover:bg-deep-slate",
          )}
          title="Collapse all rows"
        >
          <LucideIcon name="unfold_less" className="text-[13px]" />
          <span className="hidden sm:inline">Collapse all</span>
        </button>

        {/* Expiring first */}
        <button
          type="button"
          onClick={() => setExpiringFirst((prev: boolean) => !prev)}
          className={cn(
            "h-7 px-2.5 rounded-[4px] border text-[11px] transition-colors flex items-center gap-1",
            expiringFirst
              ? "border-white/20 bg-white/8 text-white hover:bg-white/15"
              : "border-charcoal-grey text-storm-cloud hover:text-porcelain hover:bg-deep-slate",
          )}
          title="Sort accounts by earliest quota reset time"
        >
          <LucideIcon name="hourglass_top" className="text-[13px]" />
          <span className="hidden sm:inline">Expiring first</span>
        </button>

        {/* Hide disabled */}
        <button
          type="button"
          onClick={() => setHideDisabled((prev: boolean) => !prev)}
          className={cn(
            "h-7 px-2.5 rounded-[4px] border text-[11px] transition-colors flex items-center gap-1",
            hideDisabled
              ? "border-white/20 bg-white/8 text-white hover:bg-white/15"
              : "border-charcoal-grey text-storm-cloud hover:text-porcelain hover:bg-deep-slate",
          )}
          title="Hide disabled connections"
        >
          <LucideIcon name="visibility_off" className="text-[13px]" />
          <span className="hidden sm:inline">Hide disabled</span>
        </button>

        {/* Bulk: disable depleted */}
        <button
          type="button"
          onClick={handleDisableDepleted}
          disabled={bulkToggling}
          className="h-7 px-2.5 rounded-[4px] border border-charcoal-grey text-[11px] text-storm-cloud hover:text-porcelain hover:bg-deep-slate transition-colors flex items-center gap-1 disabled:opacity-50"
          title="Disable connections with depleted quota"
        >
          <LucideIcon name="block" className="text-[13px]" />
          <span className="hidden sm:inline">Turn off Empty</span>
        </button>

        {/* Bulk: enable available */}
        <button
          type="button"
          onClick={handleEnableAvailable}
          disabled={bulkToggling}
          className="h-7 px-2.5 rounded-[4px] border border-charcoal-grey text-[11px] text-storm-cloud hover:text-porcelain hover:bg-deep-slate transition-colors flex items-center gap-1 disabled:opacity-50"
          title="Enable connections that still have quota"
        >
          <LucideIcon name="check_circle" className="text-[13px]" />
          <span className="hidden sm:inline">Turn on Available</span>
        </button>

        {/* Refresh all button */}
        <button
          type="button"
          onClick={refreshAll}
          disabled={refreshingAll}
          className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh all"
        >
          <LucideIcon
            name="refresh"
            className={`text-[15px] ${refreshingAll ? "animate-spin" : ""}`}
          />
        </button>

        {/* Live toggle */}
        <button
          type="button"
          onClick={() => setAutoRefresh((prev: boolean) => !prev)}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border text-[11px] font-[510] transition-colors duration-100",
            autoRefresh
              ? "border-emerald/30 bg-emerald/8 text-emerald hover:bg-emerald/15"
              : "border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
          )}
          title={autoRefresh ? `Live — refreshes every ${countdown}s` : "Enable live auto-refresh"}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              autoRefresh ? "bg-emerald animate-pulse" : "bg-fog-grey",
            )}
          />
          {autoRefresh ? "Live" : "Paused"}
        </button>
      </div>

      {/* Grouped table */}
      <div className="rounded-[6px] border border-charcoal-grey overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_200px_140px_64px_120px] bg-pitch-black/40 border-b border-charcoal-grey px-3 py-2">
          <div className="text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey">
            Provider
          </div>
          <div className="text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey">
            Quota
          </div>
          <div className="text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey">
            Last Request At
          </div>
          <div className="text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey text-right">
            %
          </div>
          <div className="text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey text-right">
            Actions
          </div>
        </div>

        {connectionsLoading ? (
          <div className="divide-y divide-charcoal-grey/40">
            {[1, 2, 3].map((i: number) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_200px_140px_64px_120px] items-center px-3 py-2.5 bg-graphite"
              >
                <div className="flex items-center gap-2.5">
                  <div className="size-4 rounded bg-charcoal-grey/40 animate-pulse" />
                  <div className="size-5 rounded-[4px] bg-charcoal-grey/40 animate-pulse" />
                  <div className="h-3 w-24 rounded bg-charcoal-grey/40 animate-pulse" />
                </div>
                <div className="pr-3">
                  <div className="h-1.5 rounded-full bg-charcoal-grey/40 animate-pulse" />
                </div>
                <div className="flex justify-end">
                  <div className="h-3 w-8 rounded bg-charcoal-grey/40 animate-pulse" />
                </div>
                <div className="flex justify-end gap-1">
                  {[1, 2, 3].map((j: number) => (
                    <div
                      key={j}
                      className="size-6 rounded-[4px] bg-charcoal-grey/40 animate-pulse"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          (() => {
            // Group connections by provider
            const groupedByProvider = sortedConnections.reduce(
              (acc: Record<string, UsageConnection[]>, conn: UsageConnection) => {
                const list = acc[conn.provider] ?? (acc[conn.provider] = []);
                list.push(conn);
                return acc;
              },
              {} as Record<string, UsageConnection[]>,
            );
            const providerGroups = Object.entries(groupedByProvider) as [
              string,
              UsageConnection[],
            ][];

            const isEmail = (v: unknown): v is string =>
              typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

            return providerGroups.map(([provider, conns]: [string, UsageConnection[]]) => {
              const providerExpanded = collapseAll
                ? (expandedProviders[provider] ?? false)
                : (expandedProviders[provider] ?? true);

              // Latest lastUsedAt across all accounts in this provider group
              const providerLastUsed = conns.reduce((latest: number, c: UsageConnection) => {
                const t = c.lastUsedAt ? new Date(c.lastUsedAt).getTime() : 0;
                return t > latest ? t : latest;
              }, 0);
              const providerLastUsedStr = providerLastUsed
                ? new Date(providerLastUsed).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : null;

              // Accumulated progress across all connections in this provider group
              const providerTotalUsed = conns.reduce(
                (s: number, c: UsageConnection) => s + getAccumulatedProgress(c).totalUsed,
                0,
              );
              const providerTotalLimit = conns.reduce(
                (s: number, c: UsageConnection) => s + getAccumulatedProgress(c).totalLimit,
                0,
              );
              const providerPct = calculatePercentage(providerTotalUsed, providerTotalLimit);
              const providerColor = getStatusColor(providerPct);
              const providerCc = colorClasses(providerColor);

              return (
                <div key={provider} className="border-b border-charcoal-grey/60 last:border-0">
                  {/* Provider group row (top level) */}
                  <div
                    className="grid grid-cols-[1fr_200px_140px_64px_120px] items-center px-3 py-2.5 bg-graphite hover:bg-deep-slate cursor-pointer transition-colors duration-100"
                    onClick={() =>
                      setExpandedProviders((prev: Record<string, boolean>) => ({
                        ...prev,
                        // Use render-time default (true when not collapsed) so first click
                        // toggles correctly instead of always collapsing on first click.
                        [provider]: !(prev[provider] ?? !collapseAll),
                      }))
                    }
                  >
                    {/* Provider identity */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <LucideIcon
                        name={providerExpanded ? "expand_more" : "chevron_right"}
                        className="text-[13px] text-fog-grey shrink-0"
                      />
                      <div className="w-5 h-5 shrink-0 rounded-[4px] bg-white flex items-center justify-center overflow-hidden">
                        <ProviderIcon
                          src={`/providers/${provider}.png`}
                          alt={provider}
                          size={20}
                          className="object-contain"
                          fallbackText={provider?.slice(0, 2).toUpperCase() || "PR"}
                        />
                      </div>
                      <span className="text-[13px] font-[510] text-porcelain capitalize tracking-[-0.12px]">
                        {provider}
                      </span>
                      <span className="text-[11px] text-storm-cloud">
                        {conns.length} {conns.length === 1 ? "account" : "accounts"}
                      </span>
                    </div>

                    {/* Accumulated progress bar */}
                    <div className="pr-3" onClick={(e: ReactMouseEvent) => e.stopPropagation()}>
                      {providerTotalLimit > 0 ? (
                        <div className={`h-1.5 rounded-full overflow-hidden ${providerCc.track}`}>
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${providerCc.bar}`}
                            style={{ width: `${Math.min(providerPct, 100)}%` }}
                          />
                        </div>
                      ) : (
                        <div className="h-1.5 rounded-full bg-charcoal-grey/40" />
                      )}
                    </div>

                    {/* Last Request At */}
                    <div onClick={(e: ReactMouseEvent) => e.stopPropagation()}>
                      {providerLastUsedStr ? (
                        <span className="text-[11px] text-storm-cloud tabular-nums">
                          {providerLastUsedStr}
                        </span>
                      ) : (
                        <span className="text-[11px] text-storm-cloud/40">—</span>
                      )}
                    </div>

                    {/* Percentage badge */}
                    <div
                      className="text-right"
                      onClick={(e: ReactMouseEvent) => e.stopPropagation()}
                    >
                      {providerTotalLimit > 0 ? (
                        <span className={`text-[11px] font-[510] tabular-nums ${providerCc.text}`}>
                          {providerPct}%
                        </span>
                      ) : (
                        <span className="text-[11px] text-storm-cloud">—</span>
                      )}
                    </div>

                    {/* No actions on provider row */}
                    <div />
                  </div>

                  {/* Account rows (second level) */}
                  {providerExpanded &&
                    conns.map((conn: UsageConnection) => {
                      const quota = quotaData[conn.id];
                      const isLoading = loading[conn.id];
                      const error = errors[conn.id];
                      const isInactive = conn.isActive === false;
                      const rowBusy = deletingId === conn.id || togglingId === conn.id;
                      const accountExpanded = collapseAll
                        ? (expandedRows[conn.id] ?? false)
                        : (expandedRows[conn.id] ?? true);
                      const { totalLimit, pct } = getAccumulatedProgress(conn);
                      const color = getStatusColor(pct);
                      const cc = colorClasses(color);
                      const accountLabel = isEmail(conn.email)
                        ? conn.email
                        : conn.name || conn.id.slice(0, 8);

                      return (
                        <div
                          key={conn.id}
                          className={`border-t border-charcoal-grey/40 ${isInactive ? "opacity-60" : ""}`}
                        >
                          {/* Account row */}
                          <div
                            className="grid grid-cols-[1fr_200px_140px_64px_120px] items-center px-3 py-2.5 bg-pitch-black/30 hover:bg-deep-slate/60 cursor-pointer transition-colors duration-100"
                            onClick={() =>
                              setExpandedRows((prev: Record<string, boolean>) => ({
                                ...prev,
                                [conn.id]: !(prev[conn.id] ?? !collapseAll),
                              }))
                            }
                          >
                            {/* Account identity */}
                            <div className="flex items-center gap-2 pl-6 min-w-0">
                              <LucideIcon
                                name={accountExpanded ? "expand_more" : "chevron_right"}
                                className="text-[12px] text-fog-grey/70 shrink-0"
                              />
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  isInactive ? "bg-storm-cloud" : "bg-emerald-400"
                                }`}
                              />
                              <span className="text-[12px] text-porcelain/80 truncate">
                                {accountLabel}
                              </span>
                            </div>

                            {/* Accumulated progress bar */}
                            <div
                              className="pr-3"
                              onClick={(e: ReactMouseEvent) => e.stopPropagation()}
                            >
                              {totalLimit > 0 ? (
                                <div className={`h-1.5 rounded-full overflow-hidden ${cc.track}`}>
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${cc.bar}`}
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                  />
                                </div>
                              ) : (
                                <div className="h-1.5 rounded-full bg-charcoal-grey/40" />
                              )}
                            </div>

                            {/* Last Request At */}
                            <div onClick={(e: ReactMouseEvent) => e.stopPropagation()}>
                              {conn.lastUsedAt ? (
                                <span className="text-[11px] text-storm-cloud tabular-nums">
                                  {new Date(conn.lastUsedAt).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </span>
                              ) : (
                                <span className="text-[11px] text-storm-cloud/40">—</span>
                              )}
                            </div>

                            {/* Percentage badge */}
                            <div
                              className="text-right"
                              onClick={(e: ReactMouseEvent) => e.stopPropagation()}
                            >
                              {totalLimit > 0 ? (
                                <span className={`text-[11px] font-[510] tabular-nums ${cc.text}`}>
                                  {pct}%
                                </span>
                              ) : (
                                <span className="text-[11px] text-storm-cloud">—</span>
                              )}
                            </div>

                            {/* Actions */}
                            <div
                              className="flex items-center justify-end gap-0.5"
                              onClick={(e: ReactMouseEvent) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => refreshProvider(conn.id, conn.provider)}
                                disabled={isLoading || rowBusy}
                                className="flex items-center justify-center size-6 rounded-[4px] text-fog-grey hover:bg-charcoal-grey hover:text-porcelain transition-colors duration-100 disabled:opacity-40"
                                title="Refresh quota"
                              >
                                <LucideIcon
                                  name="refresh"
                                  className={`text-[14px] ${isLoading ? "animate-spin" : ""}`}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedConnection(conn);
                                  setShowEditModal(true);
                                }}
                                disabled={rowBusy}
                                className="flex items-center justify-center size-6 rounded-[4px] text-fog-grey hover:bg-charcoal-grey hover:text-porcelain transition-colors duration-100 disabled:opacity-40"
                                title="Edit connection"
                              >
                                <LucideIcon name="edit" className="text-[14px]" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openConfirm(
                                    "Delete Connection",
                                    "Are you sure you want to delete this connection?",
                                    () => handleDeleteConnection(conn.id),
                                    "danger",
                                  )
                                }
                                disabled={rowBusy}
                                className="flex items-center justify-center size-6 rounded-[4px] text-fog-grey hover:bg-warning-red/10 hover:text-warning-red transition-colors duration-100 disabled:opacity-40"
                                title="Delete connection"
                              >
                                <LucideIcon
                                  name="delete"
                                  className={`text-[14px] ${deletingId === conn.id ? "animate-pulse" : ""}`}
                                />
                              </button>
                              <div className="pl-0.5">
                                <Toggle
                                  size="sm"
                                  checked={conn.isActive ?? true}
                                  disabled={rowBusy}
                                  onChange={(nextActive: boolean) =>
                                    handleToggleConnectionActive(conn.id, nextActive)
                                  }
                                />
                              </div>
                            </div>
                          </div>

                          {/* Model sub-rows (third level) */}
                          {accountExpanded && (
                            <div
                              className={`border-t border-charcoal-grey/30 transition-opacity duration-200 ${isLoading ? "opacity-40 pointer-events-none" : "opacity-100"}`}
                            >
                              {error ? (
                                <div className="flex items-center gap-2 px-14 py-3">
                                  <LucideIcon name="error" className="text-[16px] text-red-400" />
                                  <span className="text-[11px] text-storm-cloud">{error}</span>
                                </div>
                              ) : quota?.message ? (
                                <div className="px-14 py-3">
                                  <span className="text-[11px] text-storm-cloud">
                                    {quota.message}
                                  </span>
                                </div>
                              ) : !quota?.quotas?.length ? (
                                <div className="px-14 py-3">
                                  <span className="text-[11px] text-storm-cloud">
                                    No quota data
                                  </span>
                                </div>
                              ) : (
                                quota.quotas.map((q: QuotaItem, idx: number) => {
                                  const remaining =
                                    q.remainingPercentage !== undefined
                                      ? Math.round(q.remainingPercentage)
                                      : calculatePercentage(q.used, q.total);
                                  const qColor = getStatusColor(remaining);
                                  const qcc = colorClasses(qColor);
                                  const resetCountdown = formatResetTime(q.resetAt);

                                  return (
                                    <div
                                      key={idx}
                                      className="grid grid-cols-[1fr_200px_140px_64px_120px] items-center px-3 py-2 bg-pitch-black/20 hover:bg-deep-slate/50 border-b border-charcoal-grey/30 last:border-0 transition-colors duration-100"
                                    >
                                      {/* Model name — indented */}
                                      <div className="flex items-center gap-2 pl-14 min-w-0">
                                        <span className={`text-[9px] shrink-0 ${qcc.text}`}>●</span>
                                        <span className="text-[12px] text-storm-cloud truncate">
                                          {q.name}
                                        </span>
                                      </div>

                                      {/* Progress bar */}
                                      <div className="pr-3">
                                        <div
                                          className={`h-1.5 rounded-full overflow-hidden ${qcc.track}`}
                                        >
                                          <div
                                            className={`h-full rounded-full transition-all duration-300 ${qcc.bar}`}
                                            style={{ width: `${Math.min(remaining, 100)}%` }}
                                          />
                                        </div>
                                        <div className="flex items-center justify-between mt-0.5">
                                          <span className="text-[10px] text-storm-cloud tabular-nums">
                                            {(q.used ?? 0).toLocaleString()} /{" "}
                                            {(q.total ?? 0) > 0
                                              ? (q.total ?? 0).toLocaleString()
                                              : "∞"}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Last Request At — empty for model rows */}
                                      <div />

                                      {/* Remaining % */}
                                      <div className="text-right">
                                        <span
                                          className={`text-[11px] font-[510] tabular-nums ${qcc.text}`}
                                        >
                                          {remaining}%
                                        </span>
                                      </div>

                                      {/* Resets in */}
                                      <div className="text-right pr-1">
                                        {resetCountdown !== "-" ? (
                                          <span className="text-[11px] text-storm-cloud tabular-nums">
                                            in {resetCountdown}
                                          </span>
                                        ) : (
                                          <span className="text-[11px] text-storm-cloud/40">—</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            });
          })()
        )}
      </div>

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => {
          setShowEditModal(false);
          setSelectedConnection(null);
        }}
      />

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
    </div>
  );
}
