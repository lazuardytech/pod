"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/components";
import Card from "@/shared/components/Card";
import DatePicker from "@/shared/components/DatePicker";
import Drawer from "@/shared/components/Drawer";
import LucideIcon from "@/shared/components/LucideIcon";
import Pagination from "@/shared/components/Pagination";
import Select from "@/shared/components/Select";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";
import { cn } from "@/shared/utils/cn";

import type { ReactNode } from "react";

type ProviderNameCache = Record<string, string | { name?: string } | undefined>;

type UsageProvider = { id: string; name: string };

type TokenInfo = {
  prompt_tokens?: number;
  input_tokens?: number;
  cached_tokens?: number;
  cache_read_input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
};

type LatencyInfo = { ttft?: number; total?: number };

type RequestDetail = {
  id?: string;
  timestamp?: string | number;
  model?: string;
  provider?: string;
  status?: string;
  tokens?: TokenInfo;
  latency?: LatencyInfo;
  request?: unknown;
  providerRequest?: unknown;
  providerResponse?: unknown;
  response?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

type PaginationState = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type FiltersState = {
  provider: string;
  startDate: Date | null;
  endDate: Date | null;
};

interface CollapsibleSectionProps {
  title: string;
  children?: ReactNode;
  defaultOpen?: boolean;
  icon?: string | null;
}

const OFFLINE_USAGE_PROVIDERS_CACHE_KEY = "usage:providers:list";
const OFFLINE_USAGE_PROVIDER_NODES_CACHE_KEY = "usage:provider-nodes";
const OFFLINE_USAGE_DETAILS_CACHE_KEY = "usage:request-details";
const OFFLINE_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_PAGE_SIZE = 20;

let providerNameCache: ProviderNameCache | null = null;
let providerNodesCache: Record<string, string> | null = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache, source: "memory" };
  }

  const applyNodesData = (nodesData: unknown) => {
    const payload = nodesData as { nodes?: Array<{ id: string; name: string }> };
    const nodes = payload?.nodes || [];
    providerNodesCache = {};
    for (const node of nodes) {
      providerNodesCache[node.id] = node.name;
    }
    providerNameCache = {
      ...AI_PROVIDERS,
      ...providerNodesCache,
    };
  };

  const result = await loadJsonStaleWhileRevalidate({
    url: "/api/provider-nodes",
    cacheKey: OFFLINE_USAGE_PROVIDER_NODES_CACHE_KEY,
    maxStaleMs: OFFLINE_MAX_STALE_MS,
    onCacheData: applyNodesData,
    onFreshData: applyNodesData,
  });

  return { providerNameCache, providerNodesCache, source: result.source };
}

function getProviderName(providerId: string | undefined, cache: ProviderNameCache | null) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === "string") {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  icon = null,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        fullWidth
        onClick={() => setIsOpen(!isOpen)}
        className="justify-between rounded-none p-3 h-auto bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      >
        <div className="flex items-center gap-2">
          {icon && <LucideIcon name={icon} className="text-[18px] text-text-muted" />}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <LucideIcon
          name="chevron_right"
          className={cn(
            "text-[20px] text-text-muted transition-transform duration-200",
            isOpen ? "rotate-90" : "",
          )}
        />
      </Button>

      {isOpen && <div className="p-4 border-t border-black/5 dark:border-white/5">{children}</div>}
    </div>
  );
}

function getInputTokens(tokens?: TokenInfo) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  const cache = tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
  return prompt < cache ? cache : prompt;
}

export default function RequestDetailsTab() {
  const [details, setDetails] = useState<RequestDetail[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<RequestDetail | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState<UsageProvider[]>([]);
  const [providerNameCache, setProviderNameCache] = useState<ProviderNameCache | null>(null);
  const [filters, setFilters] = useState<FiltersState>({
    provider: "",
    startDate: null,
    endDate: null,
  });
  const offlineNoticeShownRef = useRef(false);

  const notifyOfflineCache = useCallback(() => {
    if (offlineNoticeShownRef.current) return;
    offlineNoticeShownRef.current = true;
    toast.info("Network unavailable. Showing cached request data.");
  }, []);

  const clearOfflineCacheNotice = useCallback(() => {
    offlineNoticeShownRef.current = false;
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const [providersResult, namesResult] = await Promise.allSettled([
        loadJsonStaleWhileRevalidate({
          url: "/api/usage/providers",
          cacheKey: OFFLINE_USAGE_PROVIDERS_CACHE_KEY,
          maxStaleMs: OFFLINE_MAX_STALE_MS,
          onCacheData: (data: unknown) => {
            setProviders(
              ((data as { providers?: UsageProvider[] })?.providers || []) as UsageProvider[],
            );
          },
          onFreshData: (data: unknown) => {
            setProviders(
              ((data as { providers?: UsageProvider[] })?.providers || []) as UsageProvider[],
            );
          },
        }),
        fetchProviderNames(),
      ]);

      if (namesResult.status === "fulfilled") {
        setProviderNameCache(namesResult.value.providerNameCache);
      }

      const sources: Array<string | undefined> = [];
      if (providersResult.status === "fulfilled") sources.push(providersResult.value?.source);
      if (namesResult.status === "fulfilled") sources.push(namesResult.value?.source);

      if (sources.includes("cache")) notifyOfflineCache();
      else if (sources.includes("network")) clearOfflineCacheNotice();
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, [clearOfflineCacheNotice, notifyOfflineCache]);

  const applyRequestDetailsData = useCallback((data: unknown) => {
    const payload = data as { details?: RequestDetail[]; pagination?: Partial<PaginationState> };
    setDetails(payload?.details || []);
    if (payload?.pagination) {
      setPagination((prev) => ({ ...prev, ...payload.pagination }));
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    const isDefaultSnapshot =
      pagination.page === 1 &&
      pagination.pageSize === DEFAULT_PAGE_SIZE &&
      !filters.provider &&
      !filters.startDate &&
      !filters.endDate;

    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.startDate) params.append("startDate", filters.startDate.toISOString());
      if (filters.endDate) params.append("endDate", filters.endDate.toISOString());

      if (isDefaultSnapshot) {
        const result = await loadJsonStaleWhileRevalidate({
          url: `/api/usage/request-details?${params.toString()}`,
          cacheKey: OFFLINE_USAGE_DETAILS_CACHE_KEY,
          maxStaleMs: OFFLINE_MAX_STALE_MS,
          onCacheData: applyRequestDetailsData,
          onFreshData: applyRequestDetailsData,
        });
        if (result.source === "cache") notifyOfflineCache();
        else clearOfflineCacheNotice();
        return;
      }

      const res = await fetch(`/api/usage/request-details?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      applyRequestDetailsData(data);
      clearOfflineCacheNotice();
    } catch (error: unknown) {
      console.error("Failed to fetch request details:", error);
      setFetchError(error instanceof Error ? error.message : "Failed to fetch request details");
    } finally {
      setLoading(false);
    }
  }, [
    applyRequestDetailsData,
    clearOfflineCacheNotice,
    filters,
    notifyOfflineCache,
    pagination.page,
    pagination.pageSize,
  ]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const handleViewDetail = (detail: RequestDetail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage: number) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPagination((prev) => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ provider: "", startDate: null, endDate: null });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="provider-filter" className="text-sm font-medium text-text-main">
              Provider
            </label>
            <Select
              id="provider-filter"
              value={filters.provider || "__all__"}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  provider: e.target.value === "__all__" ? "" : e.target.value,
                })
              }
              options={[
                { value: "__all__", label: "All Providers" },
                ...providers.map((provider) => ({ value: provider.id, label: provider.name })),
              ]}
              placeholder="Select provider"
              className="w-full min-w-0"
              selectClassName={cn(
                "h-9 py-0 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "hover:border-black/20 dark:hover:border-white/20",
              )}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label className="text-sm font-medium text-text-main">Start Date</label>
            <DatePicker
              value={filters.startDate}
              onChange={(date: Date | null) => setFilters({ ...filters, startDate: date })}
              placeholder="Pick start date"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label className="text-sm font-medium text-text-main">End Date</label>
            <DatePicker
              value={filters.endDate}
              onChange={(date: Date | null) => setFilters({ ...filters, endDate: date })}
              placeholder="Pick end date"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <span
              className="hidden text-sm font-medium text-text-main opacity-0 lg:block"
              aria-hidden="true"
            >
              Clear
            </span>
            <Button
              variant="secondary"
              icon="delete"
              onClick={handleClearFilters}
              disabled={!filters.provider && !filters.startDate && !filters.endDate}
              className="w-full"
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left p-4 text-sm font-semibold text-text-main">Timestamp</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Model</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Provider</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">
                  Input Tokens
                </th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">
                  Output Tokens
                </th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Latency</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <LucideIcon name="progress_activity" className="animate-spin text-[20px]" />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : fetchError ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <LucideIcon name="error" className="text-[20px] text-warning-red" />
                      Failed to load request details: {fetchError}
                    </div>
                  </td>
                </tr>
              ) : details.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-text-muted">
                    No request details found
                  </td>
                </tr>
              ) : (
                details.map((detail, index) => (
                  <tr
                    key={`${detail.id}-${index}`}
                    onClick={() => handleViewDetail(detail)}
                    className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <td className="whitespace-nowrap p-4 text-sm text-text-main">
                      {new Date(detail.timestamp ?? 0).toLocaleString()}
                    </td>
                    <td className="max-w-[260px] truncate p-4 font-mono text-sm text-text-main">
                      {detail.model}
                    </td>
                    <td className="max-w-[180px] truncate p-4 text-sm text-text-main">
                      <span className="font-medium">
                        {getProviderName(detail.provider, providerNameCache)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getInputTokens(detail.tokens).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {detail.tokens?.completion_tokens?.toLocaleString() || 0}
                    </td>
                    <td className="p-4 text-sm text-text-muted">
                      <div className="flex flex-col gap-0.5">
                        <div>
                          TTFT: <span className="font-mono">{detail.latency?.ttft || 0}ms</span>
                        </div>
                        <div>
                          Total: <span className="font-mono">{detail.latency?.total || 0}ms</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && details.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
              currentPage={pagination.page}
              pageSize={pagination.pageSize}
              totalItems={pagination.totalItems}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Details"
        width="lg"
      >
        {selectedDetail && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-text-muted">ID:</span>{" "}
                <span className="break-all font-mono text-text-main">{selectedDetail.id}</span>
              </div>
              <div>
                <span className="text-text-muted">Timestamp:</span>{" "}
                <span className="text-text-main">
                  {new Date(selectedDetail.timestamp ?? 0).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Provider:</span>{" "}
                <span className="text-text-main font-medium">
                  {getProviderName(selectedDetail.provider, providerNameCache)}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Model:</span>{" "}
                <span className="text-text-main font-mono">{selectedDetail.model}</span>
              </div>
              <div>
                <span className="text-text-muted">Status:</span>{" "}
                <span
                  className={cn(
                    "font-medium",
                    selectedDetail.status === "success" ? "text-green-600" : "text-red-600",
                  )}
                >
                  {selectedDetail.status}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Latency:</span>{" "}
                <span className="text-text-main font-mono">
                  TTFT {selectedDetail.latency?.ttft || 0}ms / Total{" "}
                  {selectedDetail.latency?.total || 0}ms
                </span>
              </div>
              <div>
                <span className="text-text-muted">Input Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {getInputTokens(selectedDetail.tokens).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Output Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {selectedDetail.tokens?.completion_tokens?.toLocaleString() || 0}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <CollapsibleSection title="1. Client Request (Input)" defaultOpen={true} icon="input">
                <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                  {JSON.stringify(selectedDetail.request, null, 2)}
                </pre>
              </CollapsibleSection>

              {selectedDetail.providerRequest !== null ? (
                <CollapsibleSection title="2. Provider Request (Translated)" icon="translate">
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {JSON.stringify(selectedDetail.providerRequest, null, 2)}
                  </pre>
                </CollapsibleSection>
              ) : null}

              {selectedDetail.providerResponse !== null ? (
                <CollapsibleSection title="3. Provider Response (Raw)" icon="data_object">
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {typeof selectedDetail.providerResponse === "object"
                      ? JSON.stringify(selectedDetail.providerResponse, null, 2)
                      : String(selectedDetail.providerResponse ?? "")}
                  </pre>
                </CollapsibleSection>
              ) : null}

              <CollapsibleSection
                title="4. Client Response (Final)"
                defaultOpen={true}
                icon="output"
              >
                {(() => {
                  const resp = selectedDetail.response as
                    | { thinking?: string; content?: string }
                    | undefined;
                  return (
                    <>
                      {resp?.thinking && (
                        <div className="mb-4">
                          <h4 className="font-semibold text-text-main mb-2 flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
                            <LucideIcon name="psychology" className="text-[16px]" />
                            Thinking Process
                          </h4>
                          <pre className="max-h-[200px] max-w-full overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:p-4">
                            {resp.thinking}
                          </pre>
                        </div>
                      )}

                      <h4 className="font-semibold text-text-main mb-2 text-xs uppercase tracking-wide opacity-70">
                        Content
                      </h4>
                      <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                        {resp?.content || "[No content]"}
                      </pre>
                    </>
                  );
                })()}
              </CollapsibleSection>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
