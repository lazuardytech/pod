"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import LucideIcon from "@/shared/components/LucideIcon";
import { AI_PROVIDERS, FREE_PROVIDERS } from "@/shared/constants/providers";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";

// Keep providers without serviceKinds (default LLM) or with "llm" in serviceKinds
function isLLMProvider(id: string) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

import ProviderTopology from "@/app/(dashboard)/usage/components/ProviderTopology";
import UsageChart from "@/app/(dashboard)/usage/components/UsageChart";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/usage/components/UsageTable";
import Badge from "./Badge";
import Card from "./Card";
import SegmentedControl from "./SegmentedControl";

function timeAgo(timestamp: string | number | undefined) {
  if (timestamp == null) return "—";
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }: { timestamp?: string | number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t: number) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{timeAgo(timestamp)}</>;
}

function RecentRequests({ requests = [] }: { requests?: Record<string, unknown>[] }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Header */}
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
          Recent Requests
        </span>
      </div>

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          No requests yet.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-semibold text-text-muted w-2"></th>
                <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">
                  In / Out
                </th>
                <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r: Record<string, unknown>, i: number) => {
                const status = r.status as string;
                const ok = !status || status === "ok" || status === "success";
                return (
                  <tr key={i} className="hover:bg-bg-subtle transition-colors">
                    <td className="py-1.5">
                      <span
                        className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`}
                      />
                    </td>
                    <td
                      className="py-1.5 font-mono truncate max-w-[120px]"
                      title={r.model as string}
                    >
                      {r.model as string}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <span className="text-primary">{fmt(r.promptTokens as number)}↑</span>{" "}
                      <span className="text-success">{fmt(r.completionTokens as number)}↓</span>
                    </td>
                    <td className="py-1.5 text-right text-text-muted whitespace-nowrap">
                      <TimeAgo timestamp={r.timestamp as string} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function sortData(
  dataMap: Record<string, unknown> | undefined,
  pendingMap: Record<string, unknown> = {},
  sortBy: string,
  sortOrder: string,
) {
  return Object.entries(dataMap || {})
    .map(([key, data]: [string, unknown]) => {
      const d = data as Record<string, unknown>;
      const totalTokens = ((d.promptTokens as number) || 0) + ((d.completionTokens as number) || 0);
      const totalCost = (d.cost as number) || 0;
      const inputCost =
        totalTokens > 0 ? ((d.promptTokens as number) || 0) * (totalCost / totalTokens) : 0;
      const outputCost =
        totalTokens > 0 ? ((d.completionTokens as number) || 0) * (totalCost / totalTokens) : 0;
      return {
        ...d,
        key,
        totalTokens,
        totalCost,
        inputCost,
        outputCost,
        pending: (pendingMap[key] as number) || 0,
      };
    })
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      let valA = a[sortBy] as string | number | undefined;
      let valB = b[sortBy] as string | number | undefined;
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA == null && valB == null) return 0;
      if (valA == null) return sortOrder === "asc" ? -1 : 1;
      if (valB == null) return sortOrder === "asc" ? 1 : -1;
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function getGroupKey(item: Record<string, unknown>, keyField: string) {
  switch (keyField) {
    case "rawModel":
      return (item.rawModel as string) || "Unknown Model";
    case "accountName":
      return (
        (item.accountName as string) ||
        `Account ${(item.connectionId as string)?.slice(0, 8)}...` ||
        "Unknown Account"
      );
    case "keyName":
      return (item.keyName as string) || "Unknown Key";
    case "endpoint":
      return (item.endpoint as string) || "Unknown Endpoint";
    default:
      return (item[keyField] as string) || "Unknown";
  }
}

function groupDataByKey(data: Record<string, unknown>[], keyField: string) {
  if (!Array.isArray(data)) return [];
  const groups: Record<
    string,
    {
      groupKey: string;
      summary: {
        requests: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost: number;
        inputCost: number;
        outputCost: number;
        lastUsed: string | null;
        pending: number;
      };
      items: Record<string, unknown>[];
    }
  > = {};
  data.forEach((item: Record<string, unknown>) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
          inputCost: 0,
          outputCost: 0,
          lastUsed: null,
          pending: 0,
        },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += (item.requests as number) || 0;
    s.promptTokens += (item.promptTokens as number) || 0;
    s.completionTokens += (item.completionTokens as number) || 0;
    s.totalTokens += (item.totalTokens as number) || 0;
    s.cost += (item.cost as number) || 0;
    s.inputCost += (item.inputCost as number) || 0;
    s.outputCost += (item.outputCost as number) || 0;
    s.pending += (item.pending as number) || 0;
    const lastUsed = item.lastUsed as string | null;
    if (lastUsed && (!s.lastUsed || new Date(lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const OFFLINE_USAGE_PROVIDERS_CACHE_KEY = "usage:providers:connected";
const OFFLINE_USAGE_STATS_CACHE_KEY = "usage:stats";
const OFFLINE_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsageStatsShape {
  byModel?: Record<string, unknown>;
  byAccount?: Record<string, unknown>;
  byApiKey?: Record<string, unknown>;
  byEndpoint?: Record<string, unknown>;
  pending?: Record<string, unknown>;
  activeRequests?: unknown[];
  recentRequests?: Record<string, unknown>[];
  errorProvider?: string;
}

interface StatsGroup {
  groupKey: string;
  summary: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    inputCost: number;
    outputCost: number;
    lastUsed: string | null;
    pending: number;
  };
  items: Record<string, unknown>[];
}

interface StatsRenderItem {
  rawModel: string;
  provider: string;
  pending: number;
  requests: number;
  lastUsed: string;
  accountName?: string;
  connectionId?: string;
  keyName?: string;
  endpoint?: string;
}

export default function UsageStats({
  period: periodProp,
  setPeriod: setPeriodProp,
  hidePeriodSelector = false,
}: {
  period?: string;
  setPeriod?: (period: string) => void;
  hidePeriodSelector?: boolean;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState<UsageStatsShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState("costs");
  const [providers, setProviders] = useState<Record<string, unknown>[]>([]);
  const [periodLocal, setPeriodLocal] = useState("7d");
  const offlineNoticeShownRef = useRef(false);
  const hasLoadedStatsRef = useRef(false);
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;

  const notifyOfflineCache = useCallback(() => {
    if (offlineNoticeShownRef.current) return;
    offlineNoticeShownRef.current = true;
    toast.info("Network unavailable. Showing cached usage data.");
  }, []);

  const clearOfflineCacheNotice = useCallback(() => {
    offlineNoticeShownRef.current = false;
  }, []);

  const applyConnectedProviders = useCallback((payload: Record<string, unknown>) => {
    const seen = new Set<string>();
    const unique = ((payload?.connections as Record<string, unknown>[]) || []).filter(
      (c: Record<string, unknown>) => {
        if (c.isActive === false) return false;
        if (!isLLMProvider(c.provider as string)) return false;
        if (seen.has(c.provider as string)) return false;
        seen.add(c.provider as string);
        return true;
      },
    );

    const noAuthProviders = Object.values(FREE_PROVIDERS)
      .filter(
        (p: Record<string, unknown>) =>
          p.noAuth && !seen.has(p.id as string) && isLLMProvider(p.id as string),
      )
      .map((p: Record<string, unknown>) => ({ provider: p.id, name: p.name }));

    setProviders([...unique, ...noAuthProviders] as Record<string, unknown>[]);
  }, []);

  // Fetch connected providers once, deduplicate by provider type
  // Always include noAuth free providers (e.g. opencode) regardless of connections
  useEffect(() => {
    let cancelled = false;

    loadJsonStaleWhileRevalidate({
      url: "/api/providers",
      cacheKey: OFFLINE_USAGE_PROVIDERS_CACHE_KEY,
      maxStaleMs: OFFLINE_MAX_STALE_MS,
      onCacheData: (payload: unknown) => {
        if (cancelled) return;
        applyConnectedProviders(payload as Record<string, unknown>);
      },
      onFreshData: (payload: unknown) => {
        if (cancelled) return;
        applyConnectedProviders(payload as Record<string, unknown>);
      },
    })
      .then((result: unknown) => {
        if (cancelled) return;
        const r = result as { source: string };
        if (r.source === "cache") notifyOfflineCache();
        else clearOfflineCacheNotice();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [applyConnectedProviders, clearOfflineCacheNotice, notifyOfflineCache]);

  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    let cancelled = false;

    // First load: show full spinner; subsequent: show subtle fetching indicator
    if (!hasLoadedStatsRef.current) setLoading(true);
    else setFetching(true);

    loadJsonStaleWhileRevalidate({
      url: `/api/usage/stats?period=${period}`,
      cacheKey: `${OFFLINE_USAGE_STATS_CACHE_KEY}:${period}`,
      maxStaleMs: OFFLINE_MAX_STALE_MS,
      onCacheData: (data: unknown) => {
        if (cancelled || !data) return;
        setStats((prev) => ({
          ...(prev || {}),
          ...(data as UsageStatsShape),
        }));
      },
    })
      .then((result: unknown) => {
        if (cancelled) return;
        const r = result as { source: string };
        if (r.source === "cache") notifyOfflineCache();
        else clearOfflineCacheNotice();
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        hasLoadedStatsRef.current = true;
        setLoading(false);
        setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clearOfflineCacheNotice, notifyOfflineCache, period]);

  // SSE connection - real-time updates for activeRequests + recentRequests only
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as UsageStatsShape;
        // Always merge only real-time fields, never overwrite full stats from REST
        setStats((prev) => ({
          ...(prev || {}),
          activeRequests: data.activeRequests,
          recentRequests: data.recentRequests,
          errorProvider: data.errorProvider,
          pending: data.pending,
        }));
        setLoading(false);
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => es.close();
  }, []);

  const toggleSort = useCallback(
    (tableType: string, field: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get("sortBy") === field) {
        params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
      } else {
        params.set("sortBy", field);
        params.set("sortOrder", "asc");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap: Record<string, unknown> =
          (stats.pending?.byModel as Record<string, unknown>) || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byModel, pendingMap, sortBy, sortOrder),
            "rawModel",
          ),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group: Record<string, unknown>) => {
            const s = group.summary as { requests: number; lastUsed: string };
            return (
              <>
                <td className="px-6 py-3 text-text-muted">—</td>
                <td className="px-6 py-3 text-right">{fmt(s.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(s.lastUsed)}
                </td>
              </>
            );
          },
          renderDetailCells: (item: Record<string, unknown>) => {
            const i = item as {
              rawModel: string;
              provider: string;
              pending: number;
              requests: number;
              lastUsed: string;
            };
            return (
              <>
                <td
                  className={`px-6 py-3 font-medium transition-colors ${i.pending > 0 ? "text-primary" : ""}`}
                >
                  {i.rawModel}
                </td>
                <td className="px-6 py-3">
                  <Badge variant={i.pending > 0 ? "primary" : "neutral"} size="sm">
                    {i.provider}
                  </Badge>
                </td>
                <td className="px-6 py-3 text-right">{fmt(i.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(i.lastUsed)}
                </td>
              </>
            );
          },
        };
      }
      case "account": {
        const pendingMap: Record<string, number> = {};
        const pendingByAccount = stats.pending?.byAccount as
          | Record<string, Record<string, number>>
          | undefined;
        if (pendingByAccount) {
          Object.entries(stats.byAccount || {}).forEach(([accountKey, data]: [string, unknown]) => {
            const d = data as Record<string, unknown>;
            const connPending = pendingByAccount[d.connectionId as string];
            if (connPending) {
              const modelKey = (d.provider as string)
                ? `${d.rawModel as string} (${d.provider as string})`
                : (d.rawModel as string);
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byAccount, pendingMap, sortBy, sortOrder),
            "accountName",
          ),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group: Record<string, unknown>) => {
            const s = group.summary as { requests: number; lastUsed: string };
            return (
              <>
                <td className="px-6 py-3 text-text-muted">—</td>
                <td className="px-6 py-3 text-text-muted">—</td>
                <td className="px-6 py-3 text-right">{fmt(s.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(s.lastUsed)}
                </td>
              </>
            );
          },
          renderDetailCells: (item: Record<string, unknown>) => {
            const i = item as {
              rawModel: string;
              provider: string;
              pending: number;
              requests: number;
              lastUsed: string;
              accountName?: string;
              connectionId?: string;
            };
            return (
              <>
                <td
                  className={`px-6 py-3 font-medium transition-colors ${i.pending > 0 ? "text-primary" : ""}`}
                >
                  {i.accountName || `Account ${i.connectionId?.slice(0, 8)}...`}
                </td>
                <td
                  className={`px-6 py-3 font-medium transition-colors ${i.pending > 0 ? "text-primary" : ""}`}
                >
                  {i.rawModel}
                </td>
                <td className="px-6 py-3">
                  <Badge variant={i.pending > 0 ? "primary" : "neutral"} size="sm">
                    {i.provider}
                  </Badge>
                </td>
                <td className="px-6 py-3 text-right">{fmt(i.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(i.lastUsed)}
                </td>
              </>
            );
          },
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group: Record<string, unknown>) => {
            const s = group.summary as { requests: number; lastUsed: string };
            return (
              <>
                <td className="px-6 py-3 text-text-muted">—</td>
                <td className="px-6 py-3 text-text-muted">—</td>
                <td className="px-6 py-3 text-right">{fmt(s.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(s.lastUsed)}
                </td>
              </>
            );
          },
          renderDetailCells: (item: Record<string, unknown>) => {
            const i = item as {
              rawModel: string;
              provider: string;
              pending: number;
              requests: number;
              lastUsed: string;
              keyName?: string;
            };
            return (
              <>
                <td className="px-6 py-3 font-medium">{i.keyName}</td>
                <td className="px-6 py-3">{i.rawModel}</td>
                <td className="px-6 py-3">
                  <Badge variant="neutral" size="sm">
                    {i.provider}
                  </Badge>
                </td>
                <td className="px-6 py-3 text-right">{fmt(i.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(i.lastUsed)}
                </td>
              </>
            );
          },
        };
      }
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byEndpoint, {}, sortBy, sortOrder),
            "endpoint",
          ),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group: Record<string, unknown>) => {
            const s = group.summary as { requests: number; lastUsed: string };
            return (
              <>
                <td className="px-6 py-3 text-text-muted">—</td>
                <td className="px-6 py-3 text-text-muted">—</td>
                <td className="px-6 py-3 text-right">{fmt(s.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(s.lastUsed)}
                </td>
              </>
            );
          },
          renderDetailCells: (item: Record<string, unknown>) => {
            const i = item as {
              rawModel: string;
              provider: string;
              requests: number;
              lastUsed: string;
              endpoint?: string;
            };
            return (
              <>
                <td className="px-6 py-3 font-medium font-mono text-sm">{i.endpoint}</td>
                <td className="px-6 py-3">{i.rawModel}</td>
                <td className="px-6 py-3">
                  <Badge variant="neutral" size="sm">
                    {i.provider}
                  </Badge>
                </td>
                <td className="px-6 py-3 text-right">{fmt(i.requests)}</td>
                <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                  {fmtTime(i.lastUsed)}
                </td>
              </>
            );
          },
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  if (!stats && !loading)
    return <div className="text-text-muted">Failed to load usage statistics.</div>;

  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <LucideIcon name="progress_activity" className="text-[32px] animate-spin" />
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Period selector (hidden when controlled by parent) */}
      {!hidePeriodSelector && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <div className="grid flex-1 grid-cols-4 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex sm:flex-none">
            {PERIODS.map((p: { value: string; label: string }) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                disabled={fetching}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${period === p.value ? "bg-primary text-primary-fg shadow-sm" : "text-text-muted hover:bg-bg-hover hover:text-text"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {fetching && (
            <LucideIcon
              name="progress_activity"
              className="text-[16px] text-text-muted animate-spin"
            />
          )}
        </div>
      )}

      {/* Overview cards — rendered by MetricsLineChart above */}

      {/* Provider topology + Recent Requests */}
      {loading ? (
        spinner
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <ProviderTopology
            providers={providers}
            activeRequests={stats!.activeRequests || []}
            lastProvider={(stats!.recentRequests?.[0]?.provider as string) || ""}
            errorProvider={(stats!.errorProvider as string) || ""}
          />
          <RecentRequests requests={stats!.recentRequests || []} />
        </div>
      )}

      {/* Token / Cost chart - sync period */}
      {loading ? spinner : <UsageChart period={period} />}

      {/* Table with dropdown selector */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <select
            aria-label="Table view"
            value={tableView}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTableView(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto"
            style={{ colorScheme: "auto" }}
            name="table-view"
          >
            {TABLE_OPTIONS.map((opt: { value: string; label: string }) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <SegmentedControl
            options={[
              { value: "costs", label: "Cost" },
              { value: "tokens", label: "Tokens" },
            ]}
            value={viewMode}
            onChange={setViewMode}
            size="sm"
          />
        </div>
        {loading
          ? spinner
          : activeTableConfig && (
              <UsageTable
                title="Usage Details"
                columns={activeTableConfig.columns}
                groupedData={activeTableConfig.groupedData}
                tableType={tableView}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggleSort={toggleSort}
                viewMode={viewMode}
                storageKey={activeTableConfig.storageKey}
                renderSummaryCells={activeTableConfig.renderSummaryCells}
                renderDetailCells={activeTableConfig.renderDetailCells}
                emptyMessage={activeTableConfig.emptyMessage}
              />
            )}
      </div>
    </div>
  );
}
