"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

function TypeBadge({ type }: any) {
  const styles: Record<string, any> = {
    http: "bg-aether-blue/10 text-aether-blue border-aether-blue/20",
    vercel: "bg-amethyst/10 text-amethyst border-amethyst/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-[4px] border text-[10px] font-[590] uppercase",
        styles[type] ?? "bg-deep-slate text-fog-grey border-charcoal-grey",
      )}
    >
      {type || "http"}
    </span>
  );
}

function StatusBadge({ active }: any) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-[590]",
        active ? "bg-emerald/10 text-emerald" : "bg-deep-slate text-fog-grey",
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-emerald" : "bg-fog-grey")} />
      {active ? "Enabled" : "Disabled"}
    </span>
  );
}

import { DetailRow, DetailSection, LogDrawer, LogDrawerBody, LogDrawerHeader } from "@/shared/components/LogDrawer";

export default function ProxyLogsTab({ sortBy, setSortBy, live, setLive, onRefresh, onCountChange }: any) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [selectedPool, setSelectedPool] = useState(null);
  const [internalPools, setInternalPools] = useState([]);
  const [_connected, setConnected] = useState(false);

  const esRef = useRef(null);
  const liveRef = useRef(live);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const activePools = internalPools;

  // Manual REST refresh
  const fetchPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true");
      if (!res.ok) throw new Error("Failed to fetch proxy pools");
      const data = await res.json();
      const newPools = data.proxyPools ?? [];
      setInternalPools(newPools);
      if (onCountChange) onCountChange(newPools.length);
    } catch (err) {
      setError(err.message);
    }
  }, [onCountChange]);

  // Expose fetchPools to parent via ref
  useEffect(() => {
    if (onRefresh) onRefresh.current = fetchPools;
  }, [onRefresh, fetchPools]);

  // SSE connection
  useEffect(() => {
    const connect = () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      const es = new EventSource("/api/proxy-pools/stream");
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setLoading(false);
        setError(null);
      };

      es.onmessage = (e: any) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "init" || msg.type === "update") {
            if (!liveRef.current && msg.type === "update") return;
            const pools = msg.pools ?? [];
            setInternalPools(pools);
            if (onCountChange) onCountChange(pools.length);
            setLoading(false);
          }
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
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

  const handleTest = async (pool: any) => {
    setTesting(pool.id);
    setTestResults((prev: any) => ({ ...prev, [pool.id]: null }));
    try {
      const res = await fetch(`/api/proxy-pools/${pool.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResults((prev: any) => ({
        ...prev,
        [pool.id]: res.ok
          ? { ok: true, message: data.message ?? "Connection successful" }
          : { ok: false, message: data.error ?? "Test failed" },
      }));
    } catch {
      setTestResults((prev: any) => ({ ...prev, [pool.id]: { ok: false, message: "Request failed" } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Info banner */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-[6px] border border-charcoal-grey bg-deep-slate">
        <LucideIcon name="info" className="text-[14px] text-fog-grey shrink-0" />
        <p className="text-[11px] text-fog-grey leading-[1.5]">
          Live proxy request logging is not available. Showing configured proxy pools. Manage pools in{" "}
          <Link
            href="/proxy-pools"
            className="text-storm-cloud hover:text-porcelain underline underline-offset-2 transition-colors duration-100"
          >
            Proxy Pools
          </Link>
          .
        </p>
      </div>

      {/* Table */}
      <div className="rounded-[6px] border border-charcoal-grey overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-fog-grey">
            <LucideIcon name="progress_activity" className="text-[16px] animate-spin" />
            Loading proxy pools...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <LucideIcon name="error" className="text-[28px] text-warning-red" />
            <p className="text-[12px] text-warning-red">{error}</p>
            <button
              onClick={fetchPools}
              className="mt-1 h-7 px-3 rounded-[6px] border border-charcoal-grey text-[12px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
            >
              Retry
            </button>
          </div>
        ) : activePools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <LucideIcon name="lan" className="text-[28px] text-fog-grey" />
            <p className="text-[12px] text-fog-grey">No proxy pools configured.</p>
            <Link
              href="/proxy-pools"
              className="mt-1 h-7 px-3 inline-flex items-center rounded-[6px] border border-charcoal-grey text-[12px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
            >
              Configure proxy pools
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap text-[12px]">
              <thead className="bg-pitch-black border-b border-charcoal-grey">
                <tr>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    Name
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    URL
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    Type
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    Connections
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey border-r border-charcoal-grey">
                    Status
                  </th>
                  <th className="px-3 py-2 text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey w-[120px]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {activePools.map((pool: any) => (
                  <>
                    <tr
                      key={pool.id}
                      className={cn(
                        "border-b border-charcoal-grey/50 last:border-0 cursor-pointer transition-colors duration-100",
                        selectedPool?.id === pool.id ? "bg-porcelain/5" : "hover:bg-deep-slate",
                      )}
                      onClick={() => setSelectedPool(selectedPool?.id === pool.id ? null : pool)}
                    >
                      <td className="px-3 py-2.5 border-r border-charcoal-grey/50 font-[510] text-porcelain">
                        {pool.name}
                      </td>
                      <td
                        className="px-3 py-2.5 border-r border-charcoal-grey/50 text-storm-cloud font-mono max-w-[260px] truncate"
                        title={pool.proxyUrl}
                      >
                        {pool.proxyUrl}
                      </td>
                      <td className="px-3 py-2.5 border-r border-charcoal-grey/50">
                        <TypeBadge type={pool.type} />
                      </td>
                      <td className="px-3 py-2.5 border-r border-charcoal-grey/50 text-fog-grey">
                        {pool.boundConnectionCount ?? 0}
                      </td>
                      <td className="px-3 py-2.5 border-r border-charcoal-grey/50">
                        <StatusBadge active={pool.isActive} />
                      </td>
                      <td className="px-3 py-2.5 w-[120px]">
                        <button
                          onClick={() => handleTest(pool)}
                          disabled={testing === pool.id}
                          className="flex items-center gap-1.5 h-6 px-2.5 rounded-[4px] border border-charcoal-grey text-[11px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain disabled:opacity-50 transition-colors duration-100"
                        >
                          {testing === pool.id ? (
                            <LucideIcon name="progress_activity" className="text-[12px] animate-spin" />
                          ) : (
                            <LucideIcon name="network_check" className="text-[12px]" />
                          )}
                          Test
                        </button>
                      </td>
                    </tr>
                    {testResults[pool.id] && (
                      <tr key={`${pool.id}-result`} className="border-b border-charcoal-grey/50 last:border-0">
                        <td colSpan={6} className="px-3 py-2">
                          <div
                            className={cn(
                              "flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-[4px]",
                              testResults[pool.id].ok
                                ? "bg-emerald/8 text-emerald border border-emerald/20"
                                : "bg-warning-red/8 text-warning-red border border-warning-red/20",
                            )}
                          >
                            <LucideIcon
                              name={testResults[pool.id].ok ? "check_circle" : "error"}
                              className="text-[13px]"
                            />
                            {testResults[pool.id].message}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Proxy Pool Detail Drawer */}
      <LogDrawer open={!!selectedPool} onClose={() => setSelectedPool(null)}>
        <LogDrawerHeader title="Proxy Pool Detail" onClose={() => setSelectedPool(null)}>
          {null}
        </LogDrawerHeader>
        <LogDrawerBody>
          {selectedPool && (
            <>
              <DetailSection title="Pool Info" icon="lan">
                <DetailRow label="Name" value={selectedPool.name} accent="text-porcelain font-[510]" />
                <DetailRow label="URL" value={selectedPool.proxyUrl} mono accent="" />
                <DetailRow label="Type" value={selectedPool.type || "http"} accent="" />
                <DetailRow
                  label="Status"
                  value={selectedPool.isActive ? "Enabled" : "Disabled"}
                  accent={selectedPool.isActive ? "text-emerald" : "text-warning-red"}
                />
                <DetailRow label="Connections" value={String(selectedPool.boundConnectionCount ?? 0)} accent="" />
              </DetailSection>

              {selectedPool.username && (
                <DetailSection title="Authentication" icon="lock">
                  <DetailRow label="Username" value={selectedPool.username} mono accent="" />
                  <DetailRow label="Password" value="••••••••" mono accent="" />
                </DetailSection>
              )}

              {selectedPool.noProxy && (
                <DetailSection title="No Proxy" icon="block">
                  <DetailRow label="Bypass" value={selectedPool.noProxy} mono accent="" />
                </DetailSection>
              )}

              {testResults[selectedPool.id] && (
                <DetailSection title="Last Test Result" icon="network_check">
                  <div
                    className={cn(
                      "flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-[4px]",
                      testResults[selectedPool.id].ok
                        ? "bg-emerald/8 text-emerald border border-emerald/20"
                        : "bg-warning-red/8 text-warning-red border border-warning-red/20",
                    )}
                  >
                    <LucideIcon
                      name={testResults[selectedPool.id].ok ? "check_circle" : "error"}
                      className="text-[13px]"
                    />
                    {testResults[selectedPool.id].message}
                  </div>
                </DetailSection>
              )}

              <div className="pt-2">
                <button
                  onClick={(e: any) => {
                    e.stopPropagation();
                    handleTest(selectedPool);
                  }}
                  disabled={testing === selectedPool.id}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-[6px] border border-charcoal-grey text-[12px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain disabled:opacity-50 transition-colors duration-100"
                >
                  {testing === selectedPool.id ? (
                    <LucideIcon name="progress_activity" className="text-[13px] animate-spin" />
                  ) : (
                    <LucideIcon name="network_check" className="text-[13px]" />
                  )}
                  Test Connection
                </button>
              </div>
            </>
          )}
        </LogDrawerBody>
      </LogDrawer>
    </div>
  );
}
