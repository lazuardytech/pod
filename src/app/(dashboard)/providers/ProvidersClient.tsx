"use client";

import Link from "next/link";
import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, ReactNode } from "react";
import { toast } from "sonner";
import type { ProviderConnection, ProviderNode } from "@/lib/localDb";
import type { ProviderDefinition } from "@/shared/constants/providers";
import type { HeaderActionState } from "@/store/headerActionStore";
import type { HeaderSearchState } from "@/store/headerSearchStore";
import {
  Badge,
  Button,
  Card,
  CardSkeleton,
  IconButton,
  Input,
  Modal,
  Select,
  Toggle,
} from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { APIKEY_PROVIDERS, OAUTH_PROVIDERS, WEB_COOKIE_PROVIDERS } from "@/shared/constants/config";
import {
  AI_PROVIDERS,
  ANTHROPIC_COMPATIBLE_PREFIX,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";
import { mutateJsonWithOfflineQueue } from "@/shared/services/offlineMutationRequest";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { useHeaderActionStore } from "@/store/headerActionStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";

type ProviderStats = {
  connected: number;
  error: number;
  total: number;
  errorCode: string | null;
  errorTime: string | null;
  allDisabled: boolean;
};

type CompatibleProviderInfo = {
  id: string;
  name: string;
  color: string;
  textIcon: string;
  apiType?: string;
  noAuth?: boolean;
};

type CardProvider =
  | CompatibleProviderInfo
  | ProviderDefinition
  | {
      id: string;
      name: string;
      color?: string;
      textIcon?: string;
      apiType?: string;
      noAuth?: boolean;
    };

type TestBatchMode = string;

type TestResultItem = {
  connectionId?: string;
  connectionName?: string;
  provider?: string;
  valid?: boolean;
  latencyMs?: number;
  diagnosis?: { type?: string };
};

type TestResults = {
  error?: string;
  mode?: string;
  summary?: { passed?: number; failed?: number; total?: number };
  results?: TestResultItem[];
};

interface ProviderCardProps {
  providerId: string;
  provider: CardProvider;
  stats: ProviderStats;
  authType?: string;
  onToggle?: (active: boolean) => void;
}

interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (node: ProviderNode) => void;
}

interface TestResultsViewProps {
  results: TestResults;
}

const OFFLINE_PROVIDERS_CACHE_KEY = "providers:connections";
const OFFLINE_PROVIDER_NODES_CACHE_KEY = "providers:nodes";
const OFFLINE_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;

function getStatusDisplay(connected: number, error: number, errorCode: string | null) {
  const parts: ReactNode[] = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="success" size="sm" dot>
        {connected} Connected
      </Badge>,
    );
  }
  if (error > 0) {
    const errText = errorCode ? `${error} Error (${errorCode})` : `${error} Error`;
    parts.push(
      <Badge key="error" variant="error" size="sm" dot>
        {errText}
      </Badge>,
    );
  }
  if (parts.length === 0) {
    return <span className="text-text-muted">No connections</span>;
  }
  return parts;
}

function getConnectionErrorTag(connection: ProviderConnection | null | undefined) {
  if (!connection) return null;

  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error" ||
    explicitType === "auth_missing" ||
    explicitType === "token_refresh_failed" ||
    explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400) return String(numericCode);

  const fromMessage = getErrorCode(
    typeof connection.lastError === "string" ? connection.lastError : undefined,
  );
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = String(connection.lastError || "").toLowerCase();
  if (msg.includes("runtime") || msg.includes("not runnable") || msg.includes("not installed"))
    return "RUNTIME";
  if (
    msg.includes("invalid api key") ||
    msg.includes("token invalid") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized")
  )
    return "AUTH";

  return "ERR";
}

export default function ProvidersPage() {
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [providerNodes, setProviderNodes] = useState<ProviderNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);
  const [testingMode, setTestingMode] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const offlineNoticeShownRef = useRef(false);
  const searchQuery = useHeaderSearchStore((s: HeaderSearchState) => s.query);
  const registerSearch = useHeaderSearchStore((s: HeaderSearchState) => s.register);
  const unregisterSearch = useHeaderSearchStore((s: HeaderSearchState) => s.unregister);
  const registerAction = useHeaderActionStore((s: HeaderActionState) => s.register);
  const unregisterAction = useHeaderActionStore((s: HeaderActionState) => s.unregister);
  const [showConnectedOnly, setShowConnectedOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("providers:connectedOnly") === "true";
  });

  const toggleConnectedOnly = (v?: boolean) => {
    const next = typeof v === "boolean" ? v : !showConnectedOnly;
    setShowConnectedOnly(next);
    window.localStorage.setItem("providers:connectedOnly", String(next));
  };

  const notifyOfflineCache = useCallback(() => {
    if (offlineNoticeShownRef.current) return;
    offlineNoticeShownRef.current = true;
    toast.info("Network unavailable. Showing cached data.");
  }, []);

  const clearOfflineCacheNotice = useCallback(() => {
    offlineNoticeShownRef.current = false;
  }, []);

  useEffect(() => {
    registerSearch("Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    registerAction({
      label: "Connected only",
      icon: "wifi",
      active: showConnectedOnly,
      title: "Show connected providers only",
      onClick: () => toggleConnectedOnly(!showConnectedOnly),
    });
    return () => unregisterAction();
  }, [showConnectedOnly, registerAction, unregisterAction]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const matchSearch = (name: string) =>
    !searchQuery.trim() || name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  const matchConnected = (providerId: string, authType: string) => {
    if (!showConnectedOnly) return true;
    // noAuth providers are always "connected" — they need no credentials
    const providerInfo = AI_PROVIDERS[providerId];
    if (providerInfo?.noAuth) return true;
    const stats = getProviderStats(providerId, authType);
    return stats.connected > 0 && !stats.allDisabled;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [connectionsResult, nodesResult] = await Promise.allSettled([
          loadJsonStaleWhileRevalidate({
            url: "/api/providers",
            cacheKey: OFFLINE_PROVIDERS_CACHE_KEY,
            maxStaleMs: OFFLINE_MAX_STALE_MS,
            cacheTags: ["providers"],
            onCacheData: (data: unknown) => {
              const payload = data as { connections?: ProviderConnection[] };
              setConnections(payload?.connections || []);
            },
            onFreshData: (data: unknown) => {
              const payload = data as { connections?: ProviderConnection[] };
              setConnections(payload?.connections || []);
            },
          }),
          loadJsonStaleWhileRevalidate({
            url: "/api/provider-nodes",
            cacheKey: OFFLINE_PROVIDER_NODES_CACHE_KEY,
            maxStaleMs: OFFLINE_MAX_STALE_MS,
            cacheTags: ["provider-nodes"],
            onCacheData: (data: unknown) => {
              const payload = data as { nodes?: ProviderNode[] };
              setProviderNodes(payload?.nodes || []);
            },
            onFreshData: (data: unknown) => {
              const payload = data as { nodes?: ProviderNode[] };
              setProviderNodes(payload?.nodes || []);
            },
          }),
        ]);

        const usedCache = [connectionsResult, nodesResult].some(
          (result) => result.status === "fulfilled" && result.value?.source === "cache",
        );
        const gotFreshData = [connectionsResult, nodesResult].some(
          (result) => result.status === "fulfilled" && result.value?.source === "network",
        );

        if (usedCache) notifyOfflineCache();
        else if (gotFreshData) clearOfflineCacheNotice();
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [clearOfflineCacheNotice, notifyOfflineCache]);

  const getProviderStats = (providerId: string, authType: string): ProviderStats => {
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && c.authType === authType,
    );

    const getEffectiveStatus = (conn: ProviderConnection) => {
      const isCooldown = Object.entries(conn).some(
        ([k, v]) => k.startsWith("modelLock_") && v && new Date(String(v)).getTime() > Date.now(),
      );
      return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
    };

    const connected = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "active" || status === "success";
    }).length;

    const errorConns = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "error" || status === "expired" || status === "unavailable";
    });

    const error = errorConns.length;
    const total = providerConnections.length;
    const allDisabled = total > 0 && providerConnections.every((c) => c.isActive === false);

    const latestError = errorConns.sort(
      (a, b) =>
        new Date(String(b.lastErrorAt || 0)).getTime() -
        new Date(String(a.lastErrorAt || 0)).getTime(),
    )[0];
    const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
    const errorTime = latestError?.lastErrorAt
      ? getRelativeTime(String(latestError.lastErrorAt))
      : null;

    return { connected, error, total, errorCode, errorTime, allDisabled };
  };

  // Toggle all connections for a provider on/off
  const handleToggleProvider = async (providerId: string, authType: string, newActive: boolean) => {
    const providerConns = connections.filter(
      (c) => c.provider === providerId && c.authType === authType,
    );
    setConnections((prev) =>
      prev.map((c) =>
        c.provider === providerId && c.authType === authType ? { ...c, isActive: newActive } : c,
      ),
    );

    const results = await Promise.allSettled(
      providerConns.map((c) =>
        mutateJsonWithOfflineQueue({
          url: `/api/providers/${c.id}`,
          method: "PUT",
          body: { isActive: newActive },
          queueMeta: { feature: "providers-toggle", providerId, authType, connectionId: c.id },
          invalidateCacheTags: ["providers"],
        }),
      ),
    );

    const failedCount = results.filter((r) => r.status === "rejected").length;
    if (failedCount > 0) {
      toast.error(`${failedCount} provider updates failed`);
    }
  };

  const handleBatchTest = async (mode: TestBatchMode, providerId: string | null = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary ?? {};
        if (failed === 0) toast.success(`All ${total} tests passed`);
        else toast.warning(`${passed}/${total} passed, ${failed} failed`);
      }
    } catch (_error) {
      setTestResults({ error: "Test request failed" });
      toast.error("Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }))
    .filter((p) => matchSearch(p.name) && matchConnected(p.id, "apikey"));

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
    }))
    .filter((p) => matchSearch(p.name) && matchConnected(p.id, "apikey"));

  const oauthEntries = Object.entries(OAUTH_PROVIDERS).filter(
    ([id, info]) => matchSearch(info.name) && matchConnected(id, "oauth"),
  );
  const freeEntries = Object.entries(FREE_PROVIDERS).filter(
    ([id, info]) => matchSearch(info.name) && matchConnected(id, "oauth"),
  );
  const freeTierEntries = Object.entries(FREE_TIER_PROVIDERS).filter(
    ([id, info]) => matchSearch(info.name) && matchConnected(id, "apikey"),
  );
  const apikeyEntries = Object.entries(APIKEY_PROVIDERS).filter(
    ([id, info]) =>
      (info.serviceKinds ?? ["llm"]).includes("llm") &&
      matchSearch(info.name) &&
      matchConnected(id, "apikey"),
  );

  const hasAnyResult =
    oauthEntries.length > 0 ||
    freeEntries.length > 0 ||
    freeTierEntries.length > 0 ||
    apikeyEntries.length > 0 ||
    compatibleProviders.length > 0 ||
    anthropicCompatibleProviders.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {!loading && !hasAnyResult && (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <LucideIcon
            name={showConnectedOnly ? "wifi_off" : "search_off"}
            className="text-[32px] text-text-muted mb-2"
          />
          <p className="text-text-muted text-sm">
            {showConnectedOnly
              ? "No connected providers available"
              : "No providers match your search"}
          </p>
        </div>
      )}

      {/* Custom Providers (OpenAI/Anthropic Compatible) — dynamic */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            Custom Providers{" "}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:w-auto">
            <Button
              size="sm"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              Add OpenAI Compatible
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : compatibleProviders.length === 0 && anthropicCompatibleProviders.length === 0 ? (
          <div className="mt-2 flex items-center justify-center gap-2 py-2 border border-dashed border-border rounded-xl text-text-muted text-sm">
            <LucideIcon name="extension" className="text-[18px]" />
            <span>No custom providers available</span>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {[...compatibleProviders, ...anthropicCompatibleProviders].map((info) => (
              <ApiKeyProviderCard
                key={info.id}
                providerId={info.id}
                provider={info}
                stats={getProviderStats(info.id, "apikey")}
                authType="compatible"
                onToggle={(active) => handleToggleProvider(info.id, "apikey", active)}
              />
            ))}
          </div>
        )}
      </div>

      {/* OAuth Providers */}
      {oauthEntries.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
              OAuth Providers
            </h2>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <ModelAvailabilityBadge />
              <Button
                variant="outline"
                size="sm"
                icon="play_arrow"
                loading={testingMode === "oauth"}
                onClick={() => handleBatchTest("oauth")}
                disabled={!!testingMode}
                title="Test all OAuth connections"
                aria-label="Test all OAuth connections"
                className="w-full sm:w-auto"
              >
                {testingMode === "oauth" ? "Testing..." : "Test All"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {oauthEntries.map(([key, info]) => (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "oauth")}
                authType="oauth"
                onToggle={(active) => handleToggleProvider(key, "oauth", active)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Free Tier Providers */}
      {(freeEntries.length > 0 || freeTierEntries.length > 0) && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
              Free Tier Providers
            </h2>
            <Button
              variant="outline"
              size="sm"
              icon="play_arrow"
              loading={testingMode === "free"}
              onClick={() => handleBatchTest("free")}
              disabled={!!testingMode}
              title="Test all Free connections"
              aria-label="Test all Free provider connections"
              className="w-full sm:w-auto"
            >
              {testingMode === "free" ? "Testing..." : "Test All"}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {freeEntries.map(([key, info]) => (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "oauth")}
                authType="free"
                onToggle={(active) => handleToggleProvider(key, "oauth", active)}
              />
            ))}
            {freeTierEntries.map(([key, info]) => (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "apikey")}
                authType="apikey"
                onToggle={(active) => handleToggleProvider(key, "apikey", active)}
              />
            ))}
          </div>
        </div>
      )}

      {/* API Key Providers — fixed list */}
      {apikeyEntries.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
              API Key Providers{" "}
            </h2>
            <Button
              variant="outline"
              size="sm"
              icon="play_arrow"
              loading={testingMode === "apikey"}
              onClick={() => handleBatchTest("apikey")}
              disabled={!!testingMode}
              title="Test all API Key connections"
              aria-label="Test all API Key connections"
              className="w-full sm:w-auto"
            >
              {testingMode === "apikey" ? "Testing..." : "Test All"}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {apikeyEntries.map(([key, info]) => (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "apikey")}
                authType="apikey"
                onToggle={(active) => handleToggleProvider(key, "apikey", active)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Web Cookie Providers — use browser subscription cookie instead of API key */}
      {(() => {
        const visibleWebCookieProviders = Object.entries(WEB_COOKIE_PROVIDERS).filter(
          ([id, info]) => matchSearch(info.name) && matchConnected(id, "cookie"),
        );
        if (visibleWebCookieProviders.length === 0) return null;
        return (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                Web Cookie Providers
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {visibleWebCookieProviders.map(([key, info]) => (
                <ApiKeyProviderCard
                  key={key}
                  providerId={key}
                  provider={info}
                  stats={getProviderStats(key, "cookie")}
                  authType="cookie"
                  onToggle={(active) => handleToggleProvider(key, "cookie", active)}
                />
              ))}
            </div>
          </div>
        );
      })()}

      <AddOpenAICompatibleModal
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
          toggleConnectedOnly(false);
        }}
      />
      <AddAnthropicCompatibleModal
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
          toggleConnectedOnly(false);
        }}
      />

      {/* Test Results Modal */}
      {testResults && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[10vh]"
          onClick={() => setTestResults(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-surface border border-border rounded-xl w-full max-w-[600px] max-h-[86vh] sm:max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-border bg-surface/95 backdrop-blur-sm rounded-t-xl">
              <h3 className="font-semibold">Test Results</h3>
              <IconButton
                icon="close"
                title="Close test results"
                aria-label="Close test results"
                onClick={() => setTestResults(null)}
              />
            </div>
            <div className="p-5">
              <ProviderTestResultsView results={testResults} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  providerId,
  provider,
  stats,
  authType: _authType,
  onToggle,
}: ProviderCardProps) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isNoAuth = !!provider.noAuth;

  const _dotColors = {
    free: "bg-green-500",
    oauth: "bg-blue-500",
    apikey: "bg-amber-500",
    compatible: "bg-orange-500",
  };
  const _dotLabels = {
    free: "Free",
    oauth: "OAuth",
    apikey: "API Key",
    compatible: "Compatible",
  };

  return (
    <Link href={`/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3 h-full">
          <div className="flex min-w-0 items-center gap-3">
            <div className="size-8 shrink-0 rounded-lg flex items-center justify-center bg-white">
              <ProviderIcon
                src={`/providers/${provider.id}.png`}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <LucideIcon name="pause_circle" className="text-[12px]" />
                      Disabled
                    </span>
                  </Badge>
                ) : isNoAuth ? (
                  <Badge variant="success" size="sm" dot>
                    Ready
                  </Badge>
                ) : (
                  <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {errorTime && <span className="text-text-muted">{errorTime}</span>}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e: MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle?.(!!allDisabled);
                }}
              >
                <Toggle
                  size="sm"
                  checked={!allDisabled}
                  onChange={() => {}}
                  title={allDisabled ? "Enable provider" : "Disable provider"}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

ProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  authType: _authType,
  onToggle,
}: ProviderCardProps) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);

  const _dotColors = {
    free: "bg-green-500",
    oauth: "bg-blue-500",
    apikey: "bg-amber-500",
    compatible: "bg-orange-500",
  };
  const _dotLabels = {
    free: "Free",
    oauth: "OAuth",
    apikey: "API Key",
    compatible: "Compatible",
  };

  const getIconPath = () => {
    const apiType = "apiType" in provider ? provider.apiType : undefined;
    if (isCompatible)
      return apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return `/providers/${provider.id}.png`;
  };

  return (
    <Link href={`/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3 h-full">
          <div className="flex min-w-0 items-center gap-3">
            <div className="size-8 shrink-0 rounded-lg flex items-center justify-center bg-white">
              <ProviderIcon
                src={getIconPath()}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <LucideIcon name="pause_circle" className="text-[12px]" />
                      Disabled
                    </span>
                  </Badge>
                ) : (
                  <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {isCompatible && (
                      <Badge variant="default" size="sm">
                        {"apiType" in provider && provider.apiType === "responses"
                          ? "Responses"
                          : "Chat"}
                      </Badge>
                    )}
                    {isAnthropicCompatible && (
                      <Badge variant="default" size="sm">
                        Messages
                      </Badge>
                    )}
                    {errorTime && <span className="text-text-muted">{errorTime}</span>}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e: MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle?.(!!allDisabled);
                }}
              >
                <Toggle
                  size="sm"
                  checked={!allDisabled}
                  onChange={() => {}}
                  title={allDisabled ? "Enable provider" : "Disable provider"}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function AddOpenAICompatibleModal({ isOpen, onClose, onCreated }: AddModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
    identifier: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      // Auto-prepend the required prefix if user supplies a custom identifier
      // without it. Server validates that identifier starts with `openai-compatible-`.
      const rawId = formData.identifier.trim();
      const normalizedId =
        rawId && !rawId.startsWith("openai-compatible-") ? `openai-compatible-${rawId}` : rawId;
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          apiType: formData.apiType,
          baseUrl: formData.baseUrl,
          type: "openai-compatible",
          identifier: normalizedId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onCreated(data.node as ProviderNode);
        setFormData({
          name: "",
          prefix: "",
          apiType: "chat",
          baseUrl: "https://api.openai.com/v1",
          identifier: "",
        });

        toast.success("Provider node created");
      } else {
        toast.error(data?.error || `Failed to create node (HTTP ${res.status})`);
      }
    } catch (error) {
      console.error("Error creating OpenAI Compatible node:", error);
      toast.error("Network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Add OpenAI Compatible" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, name: e.target.value })
          }
          placeholder="OpenAI Compatible (Prod)"
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Identifier"
          value={formData.identifier}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, identifier: e.target.value })
          }
          placeholder="my-openai-prod"
          hint={
            'Optional. Custom suffix — the prefix "openai-compatible-" is auto-prepended. Leave empty to auto-generate.'
          }
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, prefix: e.target.value })
          }
          placeholder="oc-prod"
          hint="Required. Used as the provider prefix for model IDs."
        />
        <Select
          label="API Type"
          options={apiTypeOptions}
          value={formData.apiType}
          onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, baseUrl: e.target.value })
          }
          placeholder="https://api.openai.com/v1"
          hint="Use the base URL (ending in /v1) for your OpenAI-compatible API."
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !formData.baseUrl.trim() ||
              submitting
            }
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddOpenAICompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

function AddAnthropicCompatibleModal({ isOpen, onClose, onCreated }: AddModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: "https://api.anthropic.com/v1",
    identifier: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      // Auto-prepend the required prefix if user supplies a custom identifier
      // without it. Server validates that identifier starts with `anthropic-compatible-`.
      const rawId = formData.identifier.trim();
      const normalizedId =
        rawId && !rawId.startsWith("anthropic-compatible-")
          ? `anthropic-compatible-${rawId}`
          : rawId;
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          baseUrl: formData.baseUrl,
          type: "anthropic-compatible",
          identifier: normalizedId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onCreated(data.node as ProviderNode);
        setFormData({
          name: "",
          prefix: "",
          baseUrl: "https://api.anthropic.com/v1",
          identifier: "",
        });

        toast.success("Provider node created");
      } else {
        toast.error(data?.error || `Failed to create node (HTTP ${res.status})`);
      }
    } catch (error) {
      console.error("Error creating Anthropic Compatible node:", error);
      toast.error("Network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Add Anthropic Compatible" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, name: e.target.value })
          }
          placeholder="Anthropic Compatible (Prod)"
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Identifier"
          value={formData.identifier}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, identifier: e.target.value })
          }
          placeholder="my-anthropic-prod"
          hint={
            'Optional. Custom suffix — the prefix "anthropic-compatible-" is auto-prepended. Leave empty to auto-generate.'
          }
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, prefix: e.target.value })
          }
          placeholder="ac-prod"
          hint="Required. Used as the provider prefix for model IDs."
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, baseUrl: e.target.value })
          }
          placeholder="https://api.anthropic.com/v1"
          hint="Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages."
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !formData.baseUrl.trim() ||
              submitting
            }
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddAnthropicCompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

function ProviderTestResultsView({ results }: TestResultsViewProps) {
  if (results.error && !results.results) {
    return (
      <div className="text-center py-6">
        <LucideIcon name="error" className="text-red-500 text-[32px] mb-2 block" />
        <p className="text-sm text-red-400">{results.error}</p>
      </div>
    );
  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel =
    (
      {
        oauth: "OAuth",
        free: "Free",
        apikey: "API Key",
        provider: "Provider",
        all: "All",
      } as Record<string, string>
    )[mode || ""] || mode;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="flex flex-wrap items-center gap-2 text-xs mb-1 sm:gap-3">
          <span className="text-text-muted">{modeLabel} Test</span>
          <Badge variant="success">{summary.passed} passed</Badge>
          {(summary.failed ?? 0) > 0 && <Badge variant="error">{summary.failed} failed</Badge>}
          <span className="text-text-muted sm:ml-auto">{summary.total} tested</span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.connectionId || i}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs dark:bg-white/[0.03] sm:flex-nowrap"
        >
          <LucideIcon
            name={r.valid ? "check_circle" : "error"}
            className={`text-[16px] ${r.valid ? "text-emerald-500" : "text-red-500"}`}
          />
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium sm:inline">{r.connectionName}</span>
            <span className="block truncate text-text-muted sm:ml-1.5 sm:inline">
              ({r.provider})
            </span>
          </div>
          {r.latencyMs !== undefined && (
            <span className="shrink-0 text-text-muted font-mono tabular-nums">{r.latencyMs}ms</span>
          )}
          <Badge variant={r.valid ? "success" : "error"} size="sm">
            {r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </Badge>
        </div>
      ))}
      {items.length === 0 && (
        <div className="text-center py-4 text-text-muted text-sm">
          No active connections found for this group.
        </div>
      )}
    </div>
  );
}

ProviderTestResultsView.propTypes = {
  results: PropTypes.shape({
    mode: PropTypes.string,
    results: PropTypes.array,
    summary: PropTypes.shape({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
    }),
    error: PropTypes.string,
  }).isRequired,
};
