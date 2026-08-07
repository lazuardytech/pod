"use client";
import type { ReactNode } from "react";
import { useEffect } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { cn } from "@/shared/utils/cn";
import Badge from "./Badge";
import {
  DetailRow,
  DetailSection,
  JsonBlock,
  LogDrawer,
  LogDrawerBody,
  LogDrawerHeader,
} from "./LogDrawer";

function PayloadSection({
  title,
  icon,
  data,
}: {
  title?: ReactNode;
  icon?: string;
  data?: unknown;
}) {
  if (!data || (typeof data === "object" && Object.keys(data as object).length === 0)) return null;
  return (
    <DetailSection title={title} icon={icon}>
      <JsonBlock data={data} />
    </DetailSection>
  );
}

function TokenPill({
  label,
  value,
  color,
}: {
  label?: ReactNode;
  value?: number | string | null;
  color?: string;
}) {
  if (value === null || value === undefined) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] font-[590]",
        color,
      )}
    >
      <span className="text-[9px] uppercase tracking-wider opacity-70">{label}</span>
      {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  );
}

type RequestLog = {
  timestamp?: string;
  model?: string;
  provider?: string;
  account?: string;
  status?: string;
  combo?: string;
  promptTokens?: number;
  completionTokens?: number;
};

type RequestDetailLatency = {
  total?: number;
  totalMs?: number;
  ttfb?: number;
};

type RequestDetailTokens = {
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cached_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
};

type RequestDetail = {
  latency?: number | RequestDetailLatency;
  tokens?: RequestDetailTokens;
  request?: Record<string, unknown>;
  providerRequest?: Record<string, unknown>;
  providerResponse?: Record<string, unknown>;
  response?: Record<string, unknown>;
};

/**
 * RequestLogDetail — right-side drawer showing full detail for a request log entry.
 * Props:
 *   log     — structured log object from request_log table
 *   detail  — matched request_details payload (may be null)
 *   loading — boolean, true while fetching detail
 *   onClose — callback
 */
export default function RequestLogDetail({
  log,
  detail,
  loading,
  onClose,
}: {
  log?: RequestLog | null;
  detail?: RequestDetail | null;
  loading?: boolean;
  onClose?: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!log) return null;

  const isOk = log.status?.includes("OK");
  const isFailed = log.status?.includes("FAILED");
  const isPending = log.status?.includes("PENDING");

  const statusColor = isOk
    ? "text-emerald"
    : isFailed
      ? "text-warning-red"
      : isPending
        ? "text-aether-blue"
        : "text-fog-grey";

  const latencyObj = detail?.latency && typeof detail.latency === "object" ? detail.latency : null;
  const latencyMs =
    latencyObj?.total ??
    latencyObj?.totalMs ??
    (typeof detail?.latency === "number" ? detail.latency : null);

  const tokens = detail?.tokens ?? {};
  const promptTokens = tokens.prompt_tokens ?? tokens.input_tokens ?? log.promptTokens;
  const completionTokens = tokens.completion_tokens ?? tokens.output_tokens ?? log.completionTokens;
  const cacheRead = tokens.cache_read_input_tokens ?? tokens.cached_tokens ?? null;
  const cacheWrite = tokens.cache_creation_input_tokens ?? null;
  const reasoning = tokens.reasoning_tokens ?? null;

  const hasPayloads =
    detail &&
    (Object.keys(detail.request ?? {}).length > 0 ||
      Object.keys(detail.providerRequest ?? {}).length > 0 ||
      Object.keys(detail.providerResponse ?? {}).length > 0 ||
      Object.keys(detail.response ?? {}).length > 0);

  return (
    <LogDrawer open={!!log} onClose={onClose}>
      <LogDrawerHeader title="Request Detail" onClose={onClose} />
      <LogDrawerBody>
        {/* Summary */}
        <DetailSection title="Summary" icon="info">
          <DetailRow label="Timestamp" value={log.timestamp} mono />
          <DetailRow label="Model" value={log.model} mono accent="text-porcelain" />
          <DetailRow label="Provider" value={log.provider !== "-" ? log.provider : null} />
          <DetailRow label="Account" value={log.account !== "-" ? log.account : null} />
          <DetailRow
            label="Status"
            value={<span className={cn("text-[11px] font-[590]", statusColor)}>{log.status}</span>}
          />
          {log.combo && (
            <DetailRow
              label="Combo"
              value={
                <Badge variant="violet" size="sm">
                  {log.combo}
                </Badge>
              }
            />
          )}
        </DetailSection>

        {/* Tokens */}
        <DetailSection title="Tokens" icon="token">
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <TokenPill label="In" value={promptTokens} color="bg-aether-blue/10 text-aether-blue" />
            <TokenPill label="Out" value={completionTokens} color="bg-emerald/10 text-emerald" />
            {cacheRead !== null && cacheRead !== undefined && (
              <TokenPill label="Cache Read" color="bg-sky-500/10 text-sky-400" value={cacheRead} />
            )}
            {cacheWrite !== null && cacheWrite !== undefined && (
              <TokenPill
                label="Cache Write"
                color="bg-amber-500/10 text-amber-400"
                value={cacheWrite}
              />
            )}
            {reasoning !== null && reasoning !== undefined && (
              <TokenPill label="Reasoning" color="bg-amethyst/10 text-amethyst" value={reasoning} />
            )}
          </div>
        </DetailSection>

        {/* Latency */}
        {latencyMs !== null && latencyMs !== undefined && (
          <DetailSection title="Latency" icon="speed">
            <DetailRow label="Total" value={`${latencyMs.toLocaleString()}ms`} mono />
            {latencyObj?.ttfb !== null && latencyObj?.ttfb !== undefined && (
              <DetailRow label="TTFB" value={`${latencyObj.ttfb.toLocaleString()}ms`} mono />
            )}
          </DetailSection>
        )}

        {/* Payload sections — only shown when detail logging is on */}
        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-fog-grey">
            <LucideIcon name="progress_activity" className="text-[14px] animate-spin" />
            Loading detail...
          </div>
        )}

        {!loading && hasPayloads && (
          <>
            <PayloadSection title="Client Request" icon="upload" data={detail.request} />
            <PayloadSection title="Provider Request" icon="send" data={detail.providerRequest} />
            <PayloadSection
              title="Provider Response"
              icon="download"
              data={detail.providerResponse}
            />
            <PayloadSection title="Client Response" icon="output" data={detail.response} />
          </>
        )}

        {!loading && !hasPayloads && (
          <div className="rounded-[6px] border border-charcoal-grey bg-deep-slate p-4 text-center">
            <LucideIcon name="info" className="text-[20px] text-fog-grey mb-2 block" />
            <p className="text-[12px] text-fog-grey">
              No detailed payload available for this request.
            </p>
            <p className="text-[11px] text-fog-grey/60 mt-1">
              Enable observability in Settings to capture request/response payloads.
            </p>
          </div>
        )}
      </LogDrawerBody>
    </LogDrawer>
  );
}
