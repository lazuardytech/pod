"use client";

import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import LucideIcon from "@/shared/components/LucideIcon";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";

const OFFLINE_USAGE_CHART_CACHE_KEY = "usage:chart";
const OFFLINE_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;

const fmtNum = (n: any) => {
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat().format(Math.round(n));
};

const fmtCost = (n: any) => `$${(n || 0).toFixed(2)}`;

const PERIOD_UNIT: Record<string, any> = {
  "24h": "Today",
  "7d": "per Week",
  "30d": "per Month",
  "90d": "per Quarter",
};

function Sparkline({ data, field, color, fmt }: any) {
  const values = data.map((d: any) => d[field] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const W = 200;
  const H = 40;
  const PAD = 0;

  const points = values
    .map((v: any, i: any) => {
      const x = PAD + (i / Math.max(1, values.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - min) / range) * (H - PAD * 2 - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const areaPoints = `${PAD},${H} ${points} ${W - PAD},${H}`;

  const [hovered, setHovered] = useState<any>(null);

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-10 block"
        preserveAspectRatio="none"
        aria-hidden="true"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Area fill */}
        <polygon points={areaPoints} fill={color} fillOpacity="0.08" />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        {/* Hover dots */}
        {values.map((v: any, i: any) => {
          const x = PAD + (i / Math.max(1, values.length - 1)) * (W - PAD * 2);
          const y = H - PAD - ((v - min) / range) * (H - PAD * 2 - 2) - 1;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2"
              fill={color}
              fillOpacity={hovered === i ? 1 : 0}
              stroke="none"
              className="cursor-crosshair"
              onMouseEnter={() => setHovered(i)}
            />
          );
        })}
        {/* Invisible hover targets */}
        {values.map((v: any, i: any) => {
          const x = PAD + (i / Math.max(1, values.length - 1)) * (W - PAD * 2);
          return (
            <rect
              key={`hit-${i}`}
              x={x - 4}
              y={0}
              width={8}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
            />
          );
        })}
      </svg>
      {/* Tooltip */}
      {hovered !== null && data[hovered] && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-deep-slate border border-charcoal-grey rounded-[4px] px-2 py-0.5 text-[10px] text-porcelain whitespace-nowrap pointer-events-none z-10">
          {data[hovered].label}: {fmt(data[hovered][field] ?? 0)}
        </div>
      )}
    </div>
  );
}

const METRICS = [
  {
    key: "requests",
    label: "Total Requests",
    icon: "receipt_long",
    color: "#d0d6e0",
    fmt: fmtNum,
  },
  {
    key: "promptTokens",
    label: "Input Tokens",
    icon: "input",
    color: "#5e6ad2",
    fmt: fmtNum,
  },
  {
    key: "completionTokens",
    label: "Output Tokens",
    icon: "output",
    color: "#27a644",
    fmt: fmtNum,
  },
  {
    key: "cost",
    label: "Est. Cost",
    icon: "payments",
    color: "#f59e0b",
    fmt: fmtCost,
  },
];

export default function MetricsLineChart({ period = "7d" }: any) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const offlineNoticeShownRef = useRef(false);

  const notifyOfflineCache = useCallback(() => {
    if (offlineNoticeShownRef.current) return;
    offlineNoticeShownRef.current = true;
    toast.info("Network unavailable. Showing cached usage chart.");
  }, []);

  const clearOfflineCacheNotice = useCallback(() => {
    offlineNoticeShownRef.current = false;
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadJsonStaleWhileRevalidate({
        url: `/api/usage/chart?period=${period}`,
        cacheKey: `${OFFLINE_USAGE_CHART_CACHE_KEY}:${period}`,
        maxStaleMs: OFFLINE_MAX_STALE_MS,
        onCacheData: (chartData: any) => {
          setData(Array.isArray(chartData) ? chartData : []);
        },
        onFreshData: (chartData: any) => {
          setData(Array.isArray(chartData) ? chartData : []);
        },
      });
      if (result.source === "cache") notifyOfflineCache();
      else clearOfflineCacheNotice();
    } catch {
    } finally {
      setLoading(false);
    }
  }, [clearOfflineCacheNotice, notifyOfflineCache, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totals = data.reduce(
    (acc: any, d: any) => ({
      requests: acc.requests + (d.requests ?? 0),
      promptTokens: acc.promptTokens + (d.promptTokens ?? 0),
      completionTokens: acc.completionTokens + (d.completionTokens ?? 0),
      cost: acc.cost + (d.cost ?? 0),
    }),
    { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 },
  );

  const unit = PERIOD_UNIT[period] || "per Week";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {METRICS.map((m: any) => (
        <div
          key={m.key}
          className="rounded-[6px] border border-charcoal-grey bg-graphite overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center gap-1.5 px-3 pt-3 pb-1">
            <LucideIcon name={m.icon} className="text-[14px]" style={{ color: m.color }} />
            <span className="text-[10px] font-[590] uppercase tracking-[0.05em] text-fog-grey">
              {m.label}
            </span>
          </div>

          {/* Value */}
          <p className="text-lg font-mono font-[510] text-porcelain tracking-[-0.13px] px-3">
            {loading ? "—" : m.fmt(totals[m.key])}
          </p>

          {/* Unit */}
          <p className="text-[10px] text-fog-grey px-3 pb-2">{unit}</p>

          {/* Sparkline flush to bottom, full width */}
          {loading ? (
            <div className="h-10 bg-deep-slate animate-pulse mt-auto" />
          ) : data.length < 2 ? (
            <div className="h-10 flex items-center justify-center text-[10px] text-fog-grey mt-auto">
              No data
            </div>
          ) : (
            <div className="mt-auto w-full">
              <Sparkline data={data} field={m.key} color={m.color} fmt={m.fmt} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

MetricsLineChart.propTypes = {
  period: PropTypes.string,
};
