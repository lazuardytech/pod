"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditConnectionModal } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Toggle from "@/shared/components/Toggle";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { cn } from "@/shared/utils/cn";
import { calculatePercentage, formatResetTime, getStatusColor, parseQuotaData } from "./utils";

// Connection is eligible for the quota page when it uses OAuth or is an apikey provider whitelisted for quota
const isUsageEligible: any = (conn: any) =>
  USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) &&
  (conn.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(conn.provider));

const DEPLETED_QUOTA_THRESHOLD: any = 5; // percent
const AUTO_REFRESH_STORAGE_KEY: any = "quotaAutoRefresh";
const QUOTA_CACHE_KEY: any = "providerQuotaCache";
const QUOTA_CACHE_TTL_MS: any = 300000; // 5 minutes cache TTL
const COLLAPSE_ALL_STORAGE_KEY: any = "quotaCollapseAll";
const EXPIRING_FIRST_STORAGE_KEY: any = "quotaExpiringFirst";
const HIDE_DISABLED_STORAGE_KEY: any = "quotaHideDisabled";

const readLocalBool: any = (key: any) => {
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
  message?: string;
};

export default function ProviderLimits() {
  const [connections, setConnections]: any = useState<any[]>([]);
  const [quotaData, setQuotaData]: any = useState<Record<string, QuotaConnectionData>>(() => {
    if (typeof window === "undefined") return {};
    const cached: any = window.localStorage.getItem(QUOTA_CACHE_KEY);
    if (cached) {
      const { data, timestamp }: any = JSON.parse(cached);
      if (Date.now() - timestamp < QUOTA_CACHE_TTL_MS) return data;
    }
    return {};
  });
  const [loading, setLoading]: any = useState({});
  const [errors, setErrors]: any = useState({});
  const [autoRefresh, setAutoRefresh]: any = useState(() => {
    if (typeof window === "undefined") return true;
    const stored: any = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });
  const [_lastUpdated, setLastUpdated]: any = useState(() => {
    if (typeof window === "undefined") return null;
    const cached: any = window.localStorage.getItem(QUOTA_CACHE_KEY);
    if (cached) {
      const { timestamp }: any = JSON.parse(cached);
      if (Date.now() - timestamp < QUOTA_CACHE_TTL_MS) return new Date(timestamp);
    }
    return null;
  });
  const [refreshingAll, setRefreshingAll]: any = useState(false);
  const [countdown, setCountdown]: any = useState(60);
  const [connectionsLoading, setConnectionsLoading]: any = useState(true);
  const [deletingId, setDeletingId]: any = useState<any>(null);
  const [togglingId, setTogglingId]: any = useState<any>(null);
  const [showEditModal, setShowEditModal]: any = useState(false);
  const [selectedConnection, setSelectedConnection]: any = useState<any>(null);
  const [proxyPools, setProxyPools]: any = useState<any[]>([]);
  const [providerFilter, setProviderFilter]: any = useState("all");
  const [expiringFirst, setExpiringFirst]: any = useState(false);
  const [providerMenuOpen, setProviderMenuOpen]: any = useState(false);
  const [bulkToggling, setBulkToggling]: any = useState(false);
  const [collapseAll, setCollapseAll]: any = useState(false);
  const [expandedRows, setExpandedRows]: any = useState({});
  const [expandedProviders, setExpandedProviders]: any = useState({});
  const [hideDisabled, setHideDisabled]: any = useState(false);
  const [disabledModels, setDisabledModels]: any = useState({});

  const [confirmDialog, setConfirmDialog]: any = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null,
    variant: "default",
  });
  const openConfirm: any = (title: any, message: any, onConfirm: any, variant: any = "default") =>
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm: any = () =>
    setConfirmDialog((prev: any) => ({ ...prev, open: false, onConfirm: null }));

  const countdownRef: any = useRef<any>(null);
  const refreshingAllRef: any = useRef(false);

  // Hydrate toggle states from localStorage after mount (avoids SSR/hydration mismatch)
  useEffect(() => {
    const collapse: any = readLocalBool(COLLAPSE_ALL_STORAGE_KEY);
    const expiring: any = readLocalBool(EXPIRING_FIRST_STORAGE_KEY);
    const hide: any = readLocalBool(HIDE_DISABLED_STORAGE_KEY);
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
      .then((res: any) => res.json())
      .then((data: any) => {
        if (data && typeof data === "object" && !data.error) {
          setDisabledModels(data.disabled || data);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch all provider connections
  const fetchConnections: any = useCallback(async () => {
    try {
      const response: any = await fetch("/api/providers/client");
      if (!response.ok) throw new Error("Failed to fetch connections");

      const data: any = await response.json();
      const connectionList: any = data.connections || [];
      setConnections(connectionList);
      return connectionList;
    } catch (error) {
      console.error("Error fetching connections:", error);
      setConnections([]);
      return [];
    }
  }, []);

  // Fetch quota for a specific connection
  const fetchQuota: any = useCallback(async (connectionId: any, provider: any) => {
    setLoading((prev: any) => ({ ...prev, [connectionId]: true }));
    setErrors((prev: any) => ({ ...prev, [connectionId]: null }));

    try {
      const response: any = await fetch(`/api/usage/${connectionId}`);

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        const errorMsg: any = errorData.error || response.statusText;

        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn("[ProviderLimits] Connection not found, skipping");
          return;
        }

        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn("[ProviderLimits] Auth error while fetching quota");
          setQuotaData((prev: any) => ({
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

      const data: any = await response.json();
      // Parse quota data using provider-specific parser
      const parsedQuotas: any = parseQuotaData(provider, data);

      setQuotaData((prev: any) => ({
        ...prev,
        [connectionId]: {
          quotas: parsedQuotas,
          plan: data.plan || null,
          message: data.message || null,
          raw: data,
        },
      }));
    } catch (error) {
      console.error("[ProviderLimits] Error fetching quota");
      setErrors((prev: any) => ({
        ...prev,
        [connectionId]: (error as any).message || "Failed to fetch quota",
      }));
    } finally {
      setLoading((prev: any) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  // Refresh quota for a specific provider
  const refreshProvider: any = useCallback(
    async (connectionId: any, provider: any) => {
      await fetchQuota(connectionId, provider);
      setLastUpdated(new Date());
    },
    [fetchQuota],
  );

  const applySnapshot: any = useCallback((snapshot: any) => {
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

  const handleDeleteConnection: any = useCallback(async (id: any) => {
    setDeletingId(id);
    try {
      const res: any = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections((prev: any) => prev.filter((c: any) => c.id !== id));
        setQuotaData((prev: any) => {
          const next: any = { ...prev };
          delete next[id];
          return next;
        });
        setLoading((prev: any) => {
          const next: any = { ...prev };
          delete next[id];
          return next;
        });
        setErrors((prev: any) => {
          const next: any = { ...prev };
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

  const handleToggleConnectionActive: any = useCallback(async (id: any, isActive: any) => {
    setTogglingId(id);
    try {
      const res: any = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections((prev: any) => prev.map((c: any) => (c.id === id ? { ...c, isActive } : c)));
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    } finally {
      setTogglingId(null);
    }
  }, []);

  const handleUpdateConnection: any = useCallback(
    async (formData: any) => {
      if (!selectedConnection?.id) return;
      const connectionId: any = selectedConnection.id;
      const provider: any = selectedConnection.provider;
      try {
        const res: any = await fetch(`/api/providers/${connectionId}`, {
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
    let cancelled: any = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((res: any) => res.json())
      .then((data: any) => {
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
  const refreshAll: any = useCallback(async () => {
    if (refreshingAllRef.current) return;

    refreshingAllRef.current = true;
    setRefreshingAll(true);
    setCountdown(60);

    try {
      const conns: any = await fetchConnections();

      // Filter eligible connections (OAuth + whitelisted apikey)
      const eligibleConnections: any = conns.filter(isUsageEligible);

      await Promise.all(eligibleConnections.map((conn: any) => fetchQuota(conn.id, conn.provider)));

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
    const initializeData: any = async () => {
      setConnectionsLoading(true);
      const conns: any = await fetchConnections();
      setConnectionsLoading(false);

      const eligibleConnections: any = conns.filter(isUsageEligible);

      // Mark all as loading before fetching
      const loadingState: any = {};
      eligibleConnections.forEach((conn: any) => {
        loadingState[conn.id] = true;
      });
      setLoading(loadingState);

      await Promise.all(eligibleConnections.map((conn: any) => fetchQuota(conn.id, conn.provider)));
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

    let closed: any = false;
    let reconnectTimer: any = null;
    let es: any = null;

    const connect: any = () => {
      if (closed) return;
      es = new EventSource("/api/usage/provider-limits/stream");

      es.onmessage = (event: any) => {
        try {
          const payload: any = JSON.parse(event.data);
          if (payload?.error) return;
          applySnapshot(payload);
        } catch {
          // keep stream alive on malformed chunk
        }
      };

      es.onerror = () => {
        es.close();
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
      setCountdown((prev: any) => (prev <= 1 ? 60 : prev - 1));
    }, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [autoRefresh]);

  // Filter eligible connections (OAuth + whitelisted apikey)
  const filteredConnections: any = connections.filter(isUsageEligible);

  const providerFilteredConnections: any = filteredConnections.filter(
    (conn: any) => providerFilter === "all" || conn.provider === providerFilter,
  );

  const getEarliestResetTime: any = (conn: any) => {
    const resetTimes: any = (quotaData[conn.id]?.quotas || [])
      .map((quota: any) =>
        quota.resetAt ? new Date(quota.resetAt).getTime() : Number.POSITIVE_INFINITY,
      )
      .filter((time: any) => Number.isFinite(time));
    return resetTimes.length > 0 ? Math.min(...resetTimes) : Number.POSITIVE_INFINITY;
  };

  // Sort providers by USAGE_SUPPORTED_PROVIDERS order, then alphabetically.
  // Optionally surface accounts with quotas expiring soonest first.
  // Always hide connections that are disabled (isActive === false).
  const sortedConnections: any = [...providerFilteredConnections]
    .filter((conn: any) => !hideDisabled || conn.isActive !== false)
    .sort((a: any, b: any) => {
      if (expiringFirst) {
        const expiryDiff: any = getEarliestResetTime(a) - getEarliestResetTime(b);
        if (expiryDiff !== 0) return expiryDiff;
      }
      const orderA: any = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
      const orderB: any = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });

  // Connection is depleted when any quota entry hit the threshold
  const isConnectionDepleted: any = (conn: any) => {
    const quotas: any = quotaData[conn.id]?.quotas;
    if (!quotas?.length) return false;
    return quotas.some((q: any) => {
      if (!q.total || q.total <= 0) return false;
      return calculatePercentage(q.used, q.total) <= DEPLETED_QUOTA_THRESHOLD;
    });
  };

  const bulkSetActive: any = useCallback(
    async (targetIds: any, isActive: any) => {
      if (!targetIds.length || bulkToggling) return;
      setBulkToggling(true);
      try {
        await Promise.all(
          targetIds.map((id: any) =>
            fetch(`/api/providers/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive }),
            }),
          ),
        );
        setConnections((prev: any) =>
          prev.map((c: any) => (targetIds.includes(c.id) ? { ...c, isActive } : c)),
        );
      } catch (error) {
        console.error("Error bulk toggling connections:", error);
      } finally {
        setBulkToggling(false);
      }
    },
    [bulkToggling],
  );

  const handleDisableDepleted: any = () => {
    const ids: any = sortedConnections
      .filter((c: any) => (c.isActive ?? true) && isConnectionDepleted(c))
      .map((c: any) => c.id);
    bulkSetActive(ids, false);
  };

  const handleEnableAvailable: any = () => {
    const ids: any = sortedConnections
      .filter((c: any) => !(c.isActive ?? true) && !isConnectionDepleted(c))
      .map((c: any) => c.id);
    bulkSetActive(ids, true);
  };

  const providerOptions: any = Array.from(
    new Set<any>(filteredConnections.map((conn: any) => conn.provider)),
  ).sort();
  const selectedProviderLabel: any = providerFilter === "all" ? "All providers" : providerFilter;

  // Calculate summary stats
  const _totalProviders: any = sortedConnections.length;
  const _activeWithLimits: any = Object.values(quotaData).filter(
    (data: any) => data?.quotas?.length > 0,
  ).length;

  // Count low quotas (remaining < 30%)
  const _lowQuotasCount: any = Object.values(quotaData).reduce((count: any, data: any) => {
    if (!data?.quotas) return count;

    const hasLowQuota: any = data.quotas.some((quota: any) => {
      const percentage: any = calculatePercentage(quota.used, quota.total);
      return percentage < 30 && quota.total > 0;
    });

    return count + (hasLowQuota ? 1 : 0);
  }, 0);

  // Accumulated progress for a connection: sum used / sum total (enabled models only)
  const getAccumulatedProgress: any = (conn: any) => {
    const quotas: any = quotaData[conn.id]?.quotas || [];
    const providerAlias: any = conn.provider;
    const disabledSet: any = new Set<any>(disabledModels[providerAlias] || []);
    const enabledQuotas: any = quotas.filter((q: any) => {
      const key: any = q.modelKey || q.name;
      return !disabledSet.has(key);
    });
    const totalUsed: any = enabledQuotas.reduce((s: any, q: any) => s + (q.used || 0), 0);
    const totalLimit: any = enabledQuotas.reduce((s: any, q: any) => s + (q.total || 0), 0);
    const pct: any = calculatePercentage(totalUsed, totalLimit);
    return { totalUsed, totalLimit, pct };
  };

  // Color classes from status color name
  const colorClasses: any = (color: any) => {
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
            onClick={() => setProviderMenuOpen((prev: any) => !prev)}
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
                  {providerOptions.map((provider: any) => (
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
            const next: any = !collapseAll;
            setCollapseAll(next);
            if (next) {
              const allProviderKeys: any = sortedConnections.map((c: any) => c.provider);
              const allConnIds: any = sortedConnections.map((c: any) => c.id);
              setExpandedProviders(Object.fromEntries(allProviderKeys.map((k: any) => [k, false])));
              setExpandedRows(Object.fromEntries(allConnIds.map((id: any) => [id, false])));
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
          onClick={() => setExpiringFirst((prev: any) => !prev)}
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
          onClick={() => setHideDisabled((prev: any) => !prev)}
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
          onClick={() => setAutoRefresh((prev: any) => !prev)}
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
            {[1, 2, 3].map((i: any) => (
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
                  {[1, 2, 3].map((j: any) => (
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
            const groupedByProvider: any = (sortedConnections as any).reduce(
              (acc: any, conn: any) => {
                if (!acc[conn.provider]) acc[conn.provider] = [];
                acc[conn.provider].push(conn);
                return acc;
              },
              {},
            );
            const providerGroups: any = Object.entries(groupedByProvider);

            const isEmail: any = (v: any) =>
              typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

            return providerGroups.map(([provider, conns]: any) => {
              const providerExpanded: any = collapseAll
                ? (expandedProviders[provider] ?? false)
                : (expandedProviders[provider] ?? true);

              // Latest lastUsedAt across all accounts in this provider group
              const providerLastUsed: any = conns.reduce((latest: any, c: any) => {
                const t: any = c.lastUsedAt ? new Date(c.lastUsedAt).getTime() : 0;
                return t > latest ? t : latest;
              }, 0);
              const providerLastUsedStr: any = providerLastUsed
                ? new Date(providerLastUsed).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : null;

              // Accumulated progress across all connections in this provider group
              const providerTotalUsed: any = conns.reduce(
                (s: any, c: any) => s + getAccumulatedProgress(c).totalUsed,
                0,
              );
              const providerTotalLimit: any = conns.reduce(
                (s: any, c: any) => s + getAccumulatedProgress(c).totalLimit,
                0,
              );
              const providerPct: any = calculatePercentage(providerTotalUsed, providerTotalLimit);
              const providerColor: any = getStatusColor(providerPct);
              const providerCc: any = colorClasses(providerColor);

              return (
                <div key={provider} className="border-b border-charcoal-grey/60 last:border-0">
                  {/* Provider group row (top level) */}
                  <div
                    className="grid grid-cols-[1fr_200px_140px_64px_120px] items-center px-3 py-2.5 bg-graphite hover:bg-deep-slate cursor-pointer transition-colors duration-100"
                    onClick={() =>
                      setExpandedProviders((prev: any) => ({
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
                    <div className="pr-3" onClick={(e: any) => e.stopPropagation()}>
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
                    <div onClick={(e: any) => e.stopPropagation()}>
                      {providerLastUsedStr ? (
                        <span className="text-[11px] text-storm-cloud tabular-nums">
                          {providerLastUsedStr}
                        </span>
                      ) : (
                        <span className="text-[11px] text-storm-cloud/40">—</span>
                      )}
                    </div>

                    {/* Percentage badge */}
                    <div className="text-right" onClick={(e: any) => e.stopPropagation()}>
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
                    conns.map((conn: any) => {
                      const quota: any = quotaData[conn.id];
                      const isLoading: any = loading[conn.id];
                      const error: any = errors[conn.id];
                      const isInactive: any = conn.isActive === false;
                      const rowBusy: any = deletingId === conn.id || togglingId === conn.id;
                      const accountExpanded: any = collapseAll
                        ? (expandedRows[conn.id] ?? false)
                        : (expandedRows[conn.id] ?? true);
                      const { totalLimit, pct }: any = getAccumulatedProgress(conn);
                      const color: any = getStatusColor(pct);
                      const cc: any = colorClasses(color);
                      const accountLabel: any = isEmail(conn.email)
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
                              setExpandedRows((prev: any) => ({
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
                            <div className="pr-3" onClick={(e: any) => e.stopPropagation()}>
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
                            <div onClick={(e: any) => e.stopPropagation()}>
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
                            <div className="text-right" onClick={(e: any) => e.stopPropagation()}>
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
                              onClick={(e: any) => e.stopPropagation()}
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
                                  onChange={(nextActive: any) =>
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
                                quota.quotas.map((q: any, idx: any) => {
                                  const remaining: any =
                                    q.remainingPercentage !== undefined
                                      ? Math.round(q.remainingPercentage)
                                      : calculatePercentage(q.used, q.total);
                                  const qColor: any = getStatusColor(remaining);
                                  const qcc: any = colorClasses(qColor);
                                  const resetCountdown: any = formatResetTime(q.resetAt);

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
                                            {q.used.toLocaleString()} /{" "}
                                            {q.total > 0 ? q.total.toLocaleString() : "∞"}
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
