"use client";
import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import RequestLogDetail from "./RequestLogDetail";
import LucideIcon from "@/shared/components/LucideIcon";

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtTokens = (n) => {
  if (n == null || n === "-") return "—";
  const num = typeof n === "string" ? parseInt(n, 10) : n;
  if (Number.isNaN(num)) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
};

// ─── Badges ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: any; [key: string]: any }) {
  if (!status) return null;
  const isPending = status.includes("PENDING");
  const isFailed = status.includes("FAILED");
  const isOk = status.includes("SUCCESS");
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-[590]",
        isOk && "bg-emerald/10 text-emerald",
        isFailed && "bg-warning-red/10 text-warning-red",
        isPending && "bg-aether-blue/10 text-aether-blue animate-pulse",
        !isOk && !isFailed && !isPending && "bg-deep-slate text-fog-grey",
      )}
    >
      {status}
    </span>
  );
}

function ProviderBadge({ provider }: { provider?: any; [key: string]: any }) {
  if (!provider || provider === "-") return <span className="text-fog-grey">—</span>;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-deep-slate border border-charcoal-grey text-[10px] font-[590] text-storm-cloud uppercase">
      {provider}
    </span>
  );
}

function ComboBadge({ combo }: { combo?: any; [key: string]: any }) {
  if (!combo) return <span className="text-fog-grey/40">—</span>;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-amethyst/10 border border-amethyst/20 text-[10px] text-amethyst">
      {combo}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RequestLogger({
  sortBy,
  setSortBy,
  recording,
  setRecording,
  refreshRef,
  filterProvider,
  setFilterProvider,
  onProvidersChange,
}: {
  sortBy?: any;
  setSortBy?: any;
  recording?: any;
  setRecording?: any;
  refreshRef?: any;
  filterProvider?: any;
  setFilterProvider?: any;
  onProvidersChange?: any;
  [key: string]: any;
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [connected, setConnected] = useState(false);

  // Detail drawer state
  const [selectedLog, setSelectedLog] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailAbortRef = useRef(null);

  const esRef = useRef(null);
  const recordingRef = useRef(recording);

  // Keep recordingRef in sync
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // Fetch logs via REST (for manual refresh)
  const fetchLogs = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs?limit=300");
      if (!res.ok) return;
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch {
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Expose fetchLogs to parent via refreshRef
  useEffect(() => {
    if (refreshRef) refreshRef.current = () => fetchLogs(false);
  }, [refreshRef, fetchLogs]);

  // SSE connection for live updates
  useEffect(() => {
    const connect = () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      const es = new EventSource("/api/usage/request-logs/stream");
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setLoading(false);
      };

      es.onmessage = (e) => {
        if (!recordingRef.current) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "init" || msg.type === "update") {
            setLogs(Array.isArray(msg.logs) ? msg.logs : []);
            if (loading) setLoading(false);
          }
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        // Reconnect after 5s
        setTimeout(() => {
          if (esRef.current === null) connect();
        }, 5000);
      };
    };

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  // Open detail drawer
  const openDetail = useCallback(async (log) => {
    // Cancel any in-flight detail fetch
    if (detailAbortRef.current) {
      detailAbortRef.current.abort();
    }
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setSelectedLog(log);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/usage/request-logs/${log.id}`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setDetailData(data.detail ?? null);
      }
    } catch (e) {
      if (e?.name === "AbortError") return; // cancelled — ignore
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedLog(null);
    setDetailData(null);
  }, []);

  // Derived data
  const providers = useMemo(() => [...new Set(logs.map((l) => l.provider).filter((p) => p && p !== "-"))], [logs]);

  useEffect(() => {
    onProvidersChange?.(providers);
  }, [providers, onProvidersChange]);

  const filtered = useMemo(() => {
    let result = logs.filter((l) => {
      if (filterStatus === "ok" && !l.status?.includes("SUCCESS")) return false;
      if (filterStatus === "failed" && !l.status?.includes("FAILED")) return false;
      if (filterStatus === "pending" && !l.status?.includes("PENDING")) return false;
      if (filterStatus === "combo" && !l.combo) return false;
      if (filterProvider !== "all" && l.provider !== filterProvider) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.model?.toLowerCase().includes(q) ||
          l.provider?.toLowerCase().includes(q) ||
          l.account?.toLowerCase().includes(q) ||
          l.status?.toLowerCase().includes(q) ||
          l.combo?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    result = [...result];
    switch (sortBy) {
      case "oldest":
        result.reverse();
        break;
      case "tokens_desc":
        result.sort(
          (a, b) =>
            (b.promptTokens ?? 0) + (b.completionTokens ?? 0) - ((a.promptTokens ?? 0) + (a.completionTokens ?? 0)),
        );
        break;
      case "tokens_asc":
        result.sort(
          (a, b) =>
            (a.promptTokens ?? 0) + (a.completionTokens ?? 0) - ((b.promptTokens ?? 0) + (b.completionTokens ?? 0)),
        );
        break;
    }

    return result;
  }, [logs, filterStatus, filterProvider, search, sortBy]);

  const counts = useMemo(
    () => ({
      total: logs.length,
      ok: logs.filter((l) => l.status?.includes("SUCCESS")).length,
      failed: logs.filter((l) => l.status?.includes("FAILED")).length,
      pending: logs.filter((l) => l.status?.includes("PENDING")).length,
      combo: logs.filter((l) => l.combo).length,
    }),
    [logs],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: Search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <LucideIcon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fog-grey" />
            <input
              aria-label="Search request logs"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search request logs..."
              className="w-full h-7 pl-8 pr-3 rounded-[6px] border border-charcoal-grey bg-deep-slate text-[12px] text-porcelain placeholder:text-fog-grey focus:outline-none focus:border-porcelain/30 transition-colors duration-100"
              name="search"
            />
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1">
            {[
              { key: "all", label: "All", activeClass: "bg-porcelain/10 text-porcelain border border-porcelain/20" },
              { key: "ok", label: "Success", activeClass: "border-emerald/30 bg-emerald/8 text-emerald" },
              {
                key: "failed",
                label: "Failed",
                activeClass: "border-warning-red/30 bg-warning-red/8 text-warning-red",
              },
              { key: "pending", label: "Pending", activeClass: "border-yellow-500/30 bg-yellow-500/8 text-yellow-400" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilterStatus(f.key)}
                className={cn(
                  "h-6 px-2.5 rounded-[4px] text-[11px] font-[510] transition-colors duration-100",
                  filterStatus === f.key
                    ? f.activeClass
                    : "text-fog-grey hover:text-storm-cloud hover:bg-deep-slate border border-transparent",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: connection status + Stats */}
        <div className="flex items-center gap-2 text-[11px] text-fog-grey shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", connected ? "bg-emerald animate-pulse" : "bg-warning-red")} />
            <span className={connected ? "text-emerald" : "text-warning-red"}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="w-px h-3 bg-charcoal-grey" />
          <span className="text-storm-cloud">{counts.total}</span> total
          <span className="text-emerald">{counts.ok}</span> ok
          {counts.failed > 0 && <span className="text-warning-red">{counts.failed} failed</span>}
          {counts.pending > 0 && <span className="text-aether-blue animate-pulse">{counts.pending} pending</span>}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[6px] border border-charcoal-grey overflow-hidden">
        <div className="overflow-x-auto h-[70vh] overflow-y-auto custom-scrollbar">
          {loading && logs.length === 0 ? (
            <div className="flex h-full min-h-[18rem] items-center justify-center gap-2 text-[12px] text-fog-grey">
              <LucideIcon name="progress_activity" className="text-[16px] animate-spin" />
              Loading logs...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-2">
              <LucideIcon name="receipt_long" className="text-[28px] text-fog-grey" />
              <p className="text-[12px] text-fog-grey">
                {logs.length === 0 ? "No logs recorded yet." : "No logs match your filters."}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap text-[12px]">
              <thead className="sticky top-0 z-10 bg-pitch-black border-b border-charcoal-grey">
                <tr>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey w-[130px]">
                    Time
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    Model
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    Provider
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    Account
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey text-right">
                    In
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey text-right">
                    Out
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey w-[90px]">
                    Status
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey w-[70px]">
                    Combo
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const isSelected = selectedLog?.id === log.id;
                  const isFailed = log.status?.includes("FAILED");
                  const isPending = log.status?.includes("PENDING");

                  return (
                    <tr
                      key={log.id}
                      onClick={() => (isSelected ? closeDetail() : openDetail(log))}
                      className={cn(
                        "border-b border-charcoal-grey/50 last:border-0 cursor-pointer transition-colors duration-100",
                        isPending && "bg-aether-blue/5",
                        isFailed && !isPending && "bg-warning-red/5",
                        isSelected && "bg-porcelain/5 ring-1 ring-inset ring-porcelain/10",
                        !isSelected && !isPending && !isFailed && "hover:bg-deep-slate",
                      )}
                    >
                      <td className="px-3 py-2 border-r border-charcoal-grey/50 text-fog-grey font-mono text-[11px]">
                        {log.timestamp}
                      </td>
                      <td
                        className="px-3 py-2 border-r border-charcoal-grey/50 text-porcelain font-mono max-w-[200px] truncate"
                        title={log.model}
                      >
                        {log.model}
                      </td>
                      <td className="px-3 py-2 border-r border-charcoal-grey/50">
                        <ProviderBadge provider={log.provider} />
                      </td>
                      <td
                        className="px-3 py-2 border-r border-charcoal-grey/50 text-storm-cloud max-w-[140px] truncate"
                        title={log.account}
                      >
                        {log.account || "—"}
                      </td>
                      <td className="px-3 py-2 border-r border-charcoal-grey/50 text-right text-aether-blue font-mono">
                        {fmtTokens(log.promptTokens)}
                      </td>
                      <td className="px-3 py-2 border-r border-charcoal-grey/50 text-right text-emerald font-mono">
                        {fmtTokens(log.completionTokens)}
                      </td>
                      <td className="px-3 py-2 border-r border-charcoal-grey/50">
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="px-3 py-2">
                        <ComboBadge combo={log.combo} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-[10px] text-fog-grey italic">
        Showing {filtered.length} of {counts.total} logs
      </p>

      {/* Detail Drawer */}
      <RequestLogDetail log={selectedLog} detail={detailData} loading={detailLoading} onClose={closeDetail} />
    </div>
  );
}
