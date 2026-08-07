"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, CardSkeleton } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";
import TelemetryCard from "./TelemetryCard";

import type { ReactNode } from "react";

type HealthProviderIcon = {
  isCompatible?: boolean;
  provider?: string;
  providerPrefix?: string;
};

type HealthSystem = {
  uptime?: number;
  nodeVersion?: string;
  platform?: string;
  arch?: string;
  memoryUsage?: { rss?: number; heapUsed?: number; heapTotal?: number };
  freeMemory?: number;
  totalMemory?: number;
};

type HealthDatabase = {
  ok?: boolean;
  integrity?: string;
  schemaVersion?: number | string;
  sizeBytes?: number;
  journalMode?: string;
  error?: string;
};

type HealthProviders = {
  total?: number;
  enabled?: number;
  combos?: number;
  apiKeys?: number;
};

type HealthTunnel = {
  cloudflareEnabled?: boolean;
  cloudflareUrl?: string;
  tailscaleEnabled?: boolean;
  tailscaleUrl?: string;
};

type HealthSemanticCache = {
  enabled?: boolean;
  hitRate?: number | string;
  maxSize?: number;
  size?: number;
  ttlMs?: number;
};

type ProviderHealthEntry = {
  state?: string;
  isCompatible?: boolean;
  provider?: string;
  providerName?: string;
  providerPrefix?: string;
  connectionCount?: number;
  rateLimitedUntil?: string | number | null;
  retryAfterMs?: number;
};

type RateLimitConn = {
  connectionId?: string;
  connectionName?: string;
  provider?: string;
  providerName?: string;
  retryAfterMs?: number;
};

type RateLimitEntry = {
  provider?: string;
  providerName?: string;
  rateLimitedCount?: number;
  connections?: RateLimitConn[];
};

type BlockedModelConn = {
  connectionId?: string;
  connectionName?: string;
  provider?: string;
  providerName?: string;
  retryAfterMs?: number;
};

type BlockedModelEntry = {
  model?: string;
  blockedCount?: number;
  earliestUnblockAt?: string | number | null;
  connections?: BlockedModelConn[];
};

type ConnectionLockEntry = {
  connectionId?: string;
  connectionName?: string;
  providerName?: string;
  lockCount?: number;
  lockReason?: string;
  lockedUntil?: string | number | null;
  retryAfterMs?: number;
};

type HealthSnapshot = {
  status?: string;
  timestamp?: number | string;
  system?: HealthSystem;
  database?: HealthDatabase;
  providers?: HealthProviders;
  tunnel?: HealthTunnel;
  semanticCache?: HealthSemanticCache;
  providerHealth?: ProviderHealthEntry[];
  rateLimitStatus?: RateLimitEntry[];
  blockedModelStatus?: BlockedModelEntry[];
  connectionLockStatus?: ConnectionLockEntry[];
};

type CacheMeta = { updatedAt?: number | string };

interface StatCardProps {
  icon: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}

interface SectionHeaderProps {
  icon: string;
  title: string;
  children?: ReactNode;
}

const OFFLINE_HEALTH_CACHE_KEY = "health:snapshot";
const OFFLINE_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;

function getProviderIconSrc(p: HealthProviderIcon) {
  if (p.isCompatible) {
    if (p.provider?.startsWith(ANTHROPIC_COMPATIBLE_PREFIX)) return "/providers/anthropic-m.png";
    return "/providers/oai-cc.png";
  }
  return `/providers/${p.providerPrefix || p.provider}.png`;
}

function formatBytes(bytes: number = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number = 0) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatCard({ icon, label, value, sub = null, tone = "bg-deep-slate" }: StatCardProps) {
  return (
    <div className={`rounded-[6px] border border-charcoal-grey p-4 ${tone}`}>
      <div className="flex items-center gap-2 mb-2">
        <LucideIcon name={icon} className="text-[16px] text-fog-grey" />
        <span className="text-[11px] font-[590] uppercase tracking-[0.05em] text-fog-grey">
          {label}
        </span>
      </div>
      <p className="text-[20px] font-[510] text-porcelain tracking-[-0.2px]">{value}</p>
      {sub && <p className="text-[11px] text-storm-cloud mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionHeader({ icon, title, children }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <LucideIcon name={icon} className="text-[16px] text-fog-grey" />
        <h2 className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function HealthPage() {
  const [data, setData] = useState<HealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clearingLock, setClearingLock] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const offlineNoticeShownRef = useRef(false);

  const notifyOfflineCache = useCallback(() => {
    if (offlineNoticeShownRef.current) return;
    offlineNoticeShownRef.current = true;
    toast.info("Network unavailable. Showing cached health snapshot.");
  }, []);

  const clearOfflineCacheNotice = useCallback(() => {
    offlineNoticeShownRef.current = false;
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const result = await loadJsonStaleWhileRevalidate({
        url: "/api/monitoring/health",
        cacheKey: OFFLINE_HEALTH_CACHE_KEY,
        maxStaleMs: OFFLINE_MAX_STALE_MS,
        cacheTags: ["health"],
        fetchOptions: { cache: "no-store" },
        onCacheData: (snapshot: unknown, meta?: CacheMeta) => {
          setData(snapshot as HealthSnapshot);
          setError(null);
          setLastRefresh(new Date(meta?.updatedAt || Date.now()));
        },
        onFreshData: (snapshot: unknown, meta?: CacheMeta) => {
          setData(snapshot as HealthSnapshot);
          setError(null);
          setLastRefresh(new Date(meta?.updatedAt || Date.now()));
        },
      });

      if (result.source === "cache") notifyOfflineCache();
      else clearOfflineCacheNotice();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [clearOfflineCacheNotice, notifyOfflineCache]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // SSE connection
  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    const cleanup = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (es) {
        es.close();
        es = null;
      }
    };

    const connect = () => {
      if (closed) return;
      cleanup();
      es = new EventSource("/api/monitoring/health/stream");
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        if (closed) return;
        try {
          const payload = JSON.parse(e.data) as HealthSnapshot & { error?: string };
          if (payload.error) {
            setError(payload.error);
            return;
          }
          setData(payload);
          setError(null);
          setLastRefresh(new Date());
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        if (!closed) reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      cleanup();
      esRef.current?.close();
    };
  }, []);

  if (!data && !error) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
        {/* Header always visible */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-[590] text-porcelain tracking-[-0.18px]">Health</h1>
            <p className="text-[12px] text-storm-cloud mt-0.5">
              Live overview of system status, database, providers, and cache.
            </p>
          </div>
        </div>
        {/* Skeleton for each section */}
        <div className="flex flex-col gap-4">
          {[1, 2, 3, 4].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
        <div className="rounded-[6px] border border-warning-red/30 bg-warning-red/8 p-5 text-center">
          <LucideIcon name="error" className="text-[28px] text-warning-red mb-2" />
          <p className="text-[13px] text-warning-red">{error}</p>
          <Button size="sm" variant="secondary" onClick={fetchHealth} className="mt-3">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // data is defined past the loading/error early returns above
  const health = data as HealthSnapshot;
  const system = health.system ?? {};
  const database = health.database ?? {};
  const providers = health.providers ?? {};
  const tunnel = health.tunnel ?? {};
  const semanticCache = health.semanticCache ?? {};

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-[590] text-porcelain tracking-[-0.18px]">Health</h1>
          <p className="text-[12px] text-storm-cloud mt-0.5">
            Live overview of system status, database, providers, and cache.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[11px] text-fog-grey hidden sm:block">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={async () => {
              setRefreshing(true);
              await fetchHealth();
              setRefreshing(false);
            }}
            disabled={refreshing}
            className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh"
          >
            <LucideIcon
              name="refresh"
              className={`text-[15px] ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={`rounded-[6px] border px-4 py-3 flex items-center gap-3 ${
          health.status === "healthy"
            ? "border-emerald/30 bg-emerald/8"
            : "border-warning-red/30 bg-warning-red/8"
        }`}
      >
        <LucideIcon
          name={health.status === "healthy" ? "check_circle" : "error"}
          className={`text-[20px] ${health.status === "healthy" ? "text-emerald" : "text-warning-red"}`}
        />
        <span
          className={`text-[13px] font-[510] ${health.status === "healthy" ? "text-emerald" : "text-warning-red"}`}
        >
          {health.status === "healthy" ? "All systems operational" : "Issues detected"}
        </span>
        <span className="ml-auto text-[11px] text-fog-grey">
          {new Date(health.timestamp ?? Date.now()).toLocaleTimeString()}
        </span>
      </div>

      {/* Telemetry */}
      <TelemetryCard health={health} />

      {/* System + DB */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon="timer"
          label="Uptime"
          value={formatUptime(system.uptime)}
          tone="bg-graphite"
          sub={null}
        />
        <StatCard
          icon="code"
          label="Node.js"
          value={system.nodeVersion}
          sub={`${system.platform} / ${system.arch}`}
          tone="bg-graphite"
        />
        <StatCard
          icon="memory"
          label="Memory RSS"
          value={formatBytes(system.memoryUsage?.rss ?? 0)}
          sub={`Heap: ${formatBytes(system.memoryUsage?.heapUsed ?? 0)} / ${formatBytes(system.memoryUsage?.heapTotal ?? 0)}`}
          tone="bg-graphite"
        />
        <StatCard
          icon="developer_board"
          label="System Memory"
          value={formatBytes(system.freeMemory ?? 0)}
          sub={`Free of ${formatBytes(system.totalMemory ?? 0)}`}
          tone="bg-graphite"
        />
      </div>

      {/* Database */}
      <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
        <SectionHeader icon="database" title="Database">
          <Badge
            variant={database.ok && database.integrity === "ok" ? "success" : "error"}
            size="sm"
          >
            {database.ok && database.integrity === "ok" ? "Healthy" : "Issues"}
          </Badge>
        </SectionHeader>
        {database.ok ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-[6px] border border-charcoal-grey bg-deep-slate p-3">
              <p className="text-[10px] text-fog-grey uppercase tracking-[0.05em] mb-1">Schema</p>
              <p className="text-[13px] font-[510] text-porcelain">v{database.schemaVersion}</p>
            </div>
            <div className="rounded-[6px] border border-charcoal-grey bg-deep-slate p-3">
              <p className="text-[10px] text-fog-grey uppercase tracking-[0.05em] mb-1">
                Integrity
              </p>
              <p
                className={`text-[13px] font-[510] ${database.integrity === "ok" ? "text-emerald" : "text-warning-red"}`}
              >
                {database.integrity?.toUpperCase()}
              </p>
            </div>
            <div className="rounded-[6px] border border-charcoal-grey bg-deep-slate p-3">
              <p className="text-[10px] text-fog-grey uppercase tracking-[0.05em] mb-1">Size</p>
              <p className="text-[13px] font-[510] text-porcelain">
                {formatBytes(database.sizeBytes ?? 0)}
              </p>
            </div>
            <div className="rounded-[6px] border border-charcoal-grey bg-deep-slate p-3">
              <p className="text-[10px] text-fog-grey uppercase tracking-[0.05em] mb-1">Journal</p>
              <p className="text-[13px] font-[510] text-porcelain uppercase">
                {database.journalMode}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-warning-red">{database.error}</p>
        )}
      </div>

      {/* Providers + Tunnel + Cache */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Providers */}
        <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
          <SectionHeader icon="dns" title="Providers">
            {null}
          </SectionHeader>
          <div className="space-y-2">
            {[
              { label: "Total connections", value: providers.total },
              { label: "Enabled", value: providers.enabled },
              { label: "Combos", value: providers.combos },
              { label: "API keys", value: providers.apiKeys },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between py-1 border-b border-charcoal-grey last:border-0"
              >
                <span className="text-[12px] text-storm-cloud">{row.label}</span>
                <span className="text-[12px] font-[510] text-porcelain">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tunnel */}
        <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
          <SectionHeader icon="vpn_lock" title="Tunnel">
            {null}
          </SectionHeader>
          <div className="space-y-2">
            {[
              {
                label: "Cloudflare",
                active: tunnel.cloudflareEnabled,
                url: tunnel.cloudflareUrl,
              },
              {
                label: "Tailscale",
                active: tunnel.tailscaleEnabled,
                url: tunnel.tailscaleUrl,
              },
            ].map((t) => (
              <div
                key={t.label}
                className="flex items-start justify-between py-1 border-b border-charcoal-grey last:border-0 gap-2"
              >
                <span className="text-[12px] text-storm-cloud">{t.label}</span>
                <div className="text-right">
                  <Badge variant={t.active ? "success" : "default"} size="sm">
                    {t.active ? "Active" : "Inactive"}
                  </Badge>
                  {t.active && t.url && (
                    <p className="text-[10px] text-fog-grey font-mono mt-0.5 truncate max-w-[140px]">
                      {t.url}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Semantic Cache */}
        <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
          <SectionHeader icon="cached" title="Semantic Cache">
            <Badge variant={semanticCache.enabled ? "success" : "default"} size="sm">
              {semanticCache.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </SectionHeader>
          <div className="space-y-2">
            {[
              { label: "Max size", value: semanticCache.maxSize ?? "—" },
              {
                label: "TTL",
                value: semanticCache.ttlMs ? `${Math.round(semanticCache.ttlMs / 60000)}m` : "—",
              },
              { label: "Entries", value: semanticCache.size ?? "—" },
              {
                label: "Hit rate",
                value:
                  typeof semanticCache.hitRate === "number"
                    ? `${semanticCache.hitRate.toFixed(1)}%`
                    : "—",
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between py-1 border-b border-charcoal-grey last:border-0"
              >
                <span className="text-[12px] text-storm-cloud">{row.label}</span>
                <span className="text-[12px] font-[510] text-porcelain">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Provider Health */}
      <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
        <SectionHeader icon="health_and_safety" title="Provider Health">
          <div className="flex items-center gap-3 text-[11px] text-fog-grey">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-emerald" /> Healthy
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-[#f59e0b]" /> Error
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-warning-red" /> Rate Limited
            </span>
          </div>
        </SectionHeader>
        {!health.providerHealth?.length ? (
          <p className="text-[12px] text-fog-grey text-center py-4">
            No provider connections configured.
          </p>
        ) : (
          (() => {
            const unhealthy = (health.providerHealth || []).filter((p) => p.state !== "CLOSED");
            const healthy = (health.providerHealth || []).filter((p) => p.state === "CLOSED");
            return (
              <div className="space-y-3">
                {unhealthy.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-[590] text-warning-red uppercase tracking-[0.05em]">
                      Issues
                    </p>
                    {unhealthy.map((p) => (
                      <div
                        key={p.provider}
                        className={`rounded-[6px] p-3 border flex items-start gap-3 ${
                          p.state === "OPEN"
                            ? "bg-warning-red/5 border-warning-red/20"
                            : "bg-[#f59e0b]/5 border-[#f59e0b]/20"
                        }`}
                      >
                        <div
                          className={`size-2 rounded-full mt-1.5 shrink-0 ${
                            p.state === "OPEN" ? "bg-warning-red" : "bg-[#f59e0b]"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="w-4 h-4 shrink-0 rounded-[3px] bg-white flex items-center justify-center overflow-hidden">
                              <ProviderIcon
                                src={getProviderIconSrc(p)}
                                alt={p.providerName}
                                size={16}
                                fallbackText={p.providerName?.slice(0, 2).toUpperCase()}
                              />
                            </div>
                            <span className="text-[13px] font-[510] text-porcelain">
                              {p.providerName}
                            </span>
                            <Badge variant={p.state === "OPEN" ? "error" : "warning"} size="sm">
                              {p.state === "OPEN" ? "Rate Limited" : "Error"}
                            </Badge>
                            {(p.connectionCount ?? 0) > 1 && (
                              <span className="text-[10px] text-fog-grey">
                                {p.connectionCount} accounts
                              </span>
                            )}
                          </div>
                          {p.rateLimitedUntil && (
                            <p className="text-[11px] text-fog-grey mt-0.5">
                              Retry in {Math.max(0, Math.round((p.retryAfterMs ?? 0) / 1000))}s
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {healthy.length > 0 && (
                  <div>
                    {unhealthy.length > 0 && (
                      <p className="text-[10px] font-[590] text-emerald uppercase tracking-[0.05em] mb-2">
                        Operational
                      </p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {healthy.map((p) => (
                        <div
                          key={p.provider}
                          className="rounded-[6px] p-2.5 bg-emerald/5 border border-charcoal-grey flex items-center gap-2"
                        >
                          <span className="size-2 rounded-full bg-emerald shrink-0" />
                          <div className="w-4 h-4 shrink-0 rounded-[3px] bg-white flex items-center justify-center overflow-hidden">
                            <ProviderIcon
                              src={getProviderIconSrc(p)}
                              alt={p.providerName}
                              size={16}
                              fallbackText={p.providerName?.slice(0, 2).toUpperCase()}
                            />
                          </div>
                          <span
                            className="text-[12px] text-porcelain truncate"
                            title={p.providerName}
                          >
                            {p.providerName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* Model Lockout Status */}
      <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
        <SectionHeader icon="lock" title="Model Lockout Status">
          {(health.rateLimitStatus?.length ?? 0) > 0 && (
            <span className="text-[11px] text-fog-grey">
              {health.rateLimitStatus!.length} provider
              {health.rateLimitStatus!.length !== 1 ? "s" : ""} affected
            </span>
          )}
        </SectionHeader>
        {!health.rateLimitStatus?.length ? (
          <p className="text-[12px] text-fog-grey text-center py-4">
            No rate limited requests available.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(health.rateLimitStatus || []).map((rl) => (
              <div
                key={rl.provider}
                className="rounded-[6px] border border-[#f59e0b]/20 bg-[#f59e0b]/5 p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-[510] text-porcelain">{rl.providerName}</span>
                  <Badge variant="warning" size="sm">
                    {rl.rateLimitedCount} limited
                  </Badge>
                </div>
                <div className="space-y-1">
                  {(rl.connections || []).map((c) => (
                    <div
                      key={c.connectionId}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="text-storm-cloud truncate max-w-[140px]">
                        {c.connectionName}
                      </span>
                      <span className="text-fog-grey shrink-0">
                        retry in {Math.max(0, Math.round((c.retryAfterMs ?? 0) / 1000))}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rate Limit Status */}
      <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
        <SectionHeader icon="speed" title="Rate Limit Status">
          {(health.blockedModelStatus?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fog-grey">
                {health.blockedModelStatus!.length} model
                {health.blockedModelStatus!.length !== 1 ? "s" : ""} locked
              </span>
              <button
                onClick={async () => {
                  setRefreshing(true);
                  await fetchHealth();
                  setRefreshing(false);
                }}
                disabled={refreshing}
                className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh lockout status"
              >
                <LucideIcon
                  name="refresh"
                  className={`text-[15px] ${refreshing ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          )}
        </SectionHeader>
        {!health.blockedModelStatus?.length ? (
          <p className="text-[12px] text-fog-grey text-center py-4">No model lockouts available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(health.blockedModelStatus || []).map((bm) => (
              <div
                key={bm.model}
                className="rounded-[6px] border border-warning-red/20 bg-warning-red/5 p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-[12px] font-[510] text-porcelain font-mono truncate max-w-[160px]"
                    title={bm.model}
                  >
                    {bm.model === "__all" ? "(all models)" : bm.model}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="error" size="sm">
                      {bm.blockedCount} locked
                    </Badge>
                    <button
                      onClick={async () => {
                        const key = `${bm.model}`;
                        setClearingLock(key);
                        try {
                          const results = await Promise.all(
                            (bm.connections || []).map((c) =>
                              fetch("/api/models/availability", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "recheckAndClear",
                                  provider: c.provider,
                                  model: bm.model,
                                }),
                              }).then((r) => r.json()),
                            ),
                          );
                          const passedAny = results.some((r: { passed?: boolean }) => r.passed);
                          const allFailed = results.every(
                            (r: { tested?: boolean; passed?: boolean }) => r.tested && !r.passed,
                          );
                          if (passedAny) {
                            toast.success("Model recheck passed — lockout cleared");
                          } else if (allFailed) {
                            toast.error("Model still failing — lockout kept");
                          }
                          await fetchHealth();
                        } finally {
                          setClearingLock(null);
                        }
                      }}
                      disabled={clearingLock !== null}
                      className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Clear lockout and recheck"
                    >
                      <LucideIcon
                        name={clearingLock === bm.model ? "progress_activity" : "lock_open"}
                        className={`text-[15px] ${clearingLock === bm.model ? "animate-spin" : ""}`}
                      />
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {(bm.connections || []).map((c) => (
                    <div
                      key={c.connectionId}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-storm-cloud truncate max-w-[140px]">
                          {c.connectionName}
                        </span>
                        <span className="text-fog-grey/70 text-[10px]">{c.providerName}</span>
                      </div>
                      <span className="text-fog-grey shrink-0">
                        {(() => {
                          const secs = Math.max(0, Math.round((c.retryAfterMs ?? 0) / 1000));
                          if (secs >= 3600)
                            return `unblocks in ${Math.round(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
                          if (secs >= 60) return `unblocks in ${Math.round(secs / 60)}m`;
                          return `unblocks in ${secs}s`;
                        })()}
                      </span>
                    </div>
                  ))}
                </div>
                {bm.earliestUnblockAt && (
                  <p className="text-[10px] text-fog-grey mt-2 pt-2 border-t border-charcoal-grey">
                    Earliest unblock: {new Date(bm.earliestUnblockAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Account Lockout Status */}
      <div className="rounded-[6px] border border-charcoal-grey bg-graphite p-5">
        <SectionHeader icon="manage_accounts" title="Account Lockout Status">
          {(health.connectionLockStatus?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fog-grey">
                {health.connectionLockStatus!.length} account
                {health.connectionLockStatus!.length !== 1 ? "s" : ""} locked
              </span>
              <button
                onClick={async () => {
                  setRefreshing(true);
                  await fetchHealth();
                  setRefreshing(false);
                }}
                disabled={refreshing}
                className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh account lockout status"
              >
                <LucideIcon
                  name="refresh"
                  className={`text-[15px] ${refreshing ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          )}
        </SectionHeader>
        {!health.connectionLockStatus?.length ? (
          <p className="text-[12px] text-fog-grey text-center py-4">No account lockouts.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(health.connectionLockStatus || []).map((acc) => (
              <div
                key={acc.connectionId}
                className="rounded-[6px] border border-warning-red/20 bg-warning-red/5 p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-[510] text-porcelain truncate max-w-[160px]">
                      {acc.connectionName}
                    </span>
                    <span className="text-[11px] text-fog-grey">{acc.providerName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="error" size="sm">
                      lock #{acc.lockCount}
                    </Badge>
                    <button
                      onClick={async () => {
                        const key = `conn-${acc.connectionId}`;
                        setClearingLock(key);
                        try {
                          await fetch(
                            `/api/provider-nodes/${acc.connectionId}/clear-connection-lock`,
                            {
                              method: "POST",
                            },
                          );
                          toast.success(`Account lock cleared for ${acc.connectionName}`);
                          await fetchHealth();
                        } catch {
                          toast.error("Failed to clear account lock");
                        } finally {
                          setClearingLock(null);
                        }
                      }}
                      disabled={clearingLock !== null}
                      className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Clear account lock"
                    >
                      <LucideIcon
                        name={
                          clearingLock === `conn-${acc.connectionId}`
                            ? "progress_activity"
                            : "lock_open"
                        }
                        className={`text-[15px] ${clearingLock === `conn-${acc.connectionId}` ? "animate-spin" : ""}`}
                      />
                    </button>
                  </div>
                </div>
                {acc.lockReason && (
                  <p
                    className="text-[10px] text-fog-grey/80 mb-2 line-clamp-2"
                    title={acc.lockReason}
                  >
                    {acc.lockReason.slice(0, 120)}
                  </p>
                )}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-storm-cloud">
                    {(() => {
                      const secs = Math.max(0, Math.round((acc.retryAfterMs ?? 0) / 1000));
                      if (secs >= 3600)
                        return `unlocks in ${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
                      if (secs >= 60) return `unlocks in ${Math.round(secs / 60)}m`;
                      return `unlocks in ${secs}s`;
                    })()}
                  </span>
                  <span className="text-fog-grey/70 text-[10px]">
                    {new Date(acc.lockedUntil ?? Date.now()).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
