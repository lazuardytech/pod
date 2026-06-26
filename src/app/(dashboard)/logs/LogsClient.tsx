"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import RequestLogger from "@/shared/components/RequestLogger";
import SegmentedControl from "@/shared/components/SegmentedControl";
import ShadcnSelect from "@/shared/components/ShadcnSelect";
import { cn } from "@/shared/utils/cn";
import ConsoleLogClient from "./ConsoleLogClient";
import ProxyLogsTab from "./ProxyLogsTab";
import LucideIcon from "@/shared/components/LucideIcon";

const TABS = [
  { key: "request-logs", label: "Request Logs", icon: "receipt_long" },
  { key: "console", label: "Console Logs", icon: "terminal" },
  { key: "proxy-logs", label: "Proxy Logs", icon: "lan" },
];

const REQUEST_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "tokens_desc", label: "Most tokens" },
  { value: "tokens_asc", label: "Fewest tokens" },
];

const PROXY_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

function RequestLogsToolbar({
  sortBy,
  setSortBy,
  onRefresh,
  refreshing,
  recording,
  setRecording,
  filterProvider,
  setFilterProvider,
  providerOptions,
}: any) {
  return (
    <div className="flex items-center gap-2">
      {providerOptions.length > 0 && (
        <ShadcnSelect
          ariaLabel="Filter by provider"
          value={filterProvider}
          onValueChange={setFilterProvider}
          options={[
            { value: "all", label: "All Providers" },
            ...providerOptions.map((p: any) => ({ value: p, label: p })),
          ]}
          triggerClassName="h-7 w-[130px] rounded-[6px] bg-deep-slate px-2 text-[12px] shadow-none"
          contentClassName="min-w-[130px]"
          name="filter-provider"
        />
      )}
      <ShadcnSelect
        ariaLabel="Sort logs"
        value={sortBy}
        onValueChange={setSortBy}
        options={REQUEST_SORT_OPTIONS}
        triggerClassName="h-7 w-[120px] rounded-[6px] bg-deep-slate px-2 text-[12px] shadow-none"
        contentClassName="min-w-[120px]"
        name="sort-by"
      />
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Refresh"
      >
        <LucideIcon name="refresh" size={24} className={cn(refreshing && "animate-spin")} />
      </button>
      <button
        onClick={() => setRecording((v: any) => !v)}
        title={recording ? "Pause recording" : "Resume recording"}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border text-[11px] font-[510] transition-colors duration-100",
          recording
            ? "border-emerald/30 bg-emerald/8 text-emerald hover:bg-emerald/15"
            : "border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
        )}
      >
        <span className={cn("size-1.5 rounded-full", recording ? "bg-emerald animate-pulse" : "bg-fog-grey")} />
        {recording ? "Live" : "Paused"}
      </button>
    </div>
  );
}

function ProxyLogsToolbar({ sortBy, setSortBy, onRefresh, refreshing, live, setLive, count }: any) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-fog-grey">{count} configured</span>
      <div className="w-px h-4 bg-charcoal-grey" />
      <ShadcnSelect
        ariaLabel="Sort proxy logs"
        value={sortBy}
        onValueChange={setSortBy}
        options={PROXY_SORT_OPTIONS}
        triggerClassName="h-7 w-[120px] rounded-[6px] bg-deep-slate px-2 text-[12px] shadow-none"
        contentClassName="min-w-[120px]"
        name="sort-by"
      />
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Refresh"
      >
        <LucideIcon name="refresh" size={24} className={cn(refreshing && "animate-spin")} />
      </button>
      <button
        onClick={() => setLive((v: any) => !v)}
        title={live ? "Pause live" : "Resume live"}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border text-[11px] font-[510] transition-colors duration-100",
          live
            ? "border-emerald/30 bg-emerald/8 text-emerald hover:bg-emerald/15"
            : "border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
        )}
      >
        <span className={cn("size-1.5 rounded-full", live ? "bg-emerald animate-pulse" : "bg-fog-grey")} />
        {live ? "Live" : "Paused"}
      </button>
    </div>
  );
}

function ConsoleToolbar({ autoScroll, setAutoScroll, onClear, onRefresh, refreshing, live, setLive }: any) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Refresh"
      >
        <LucideIcon name="refresh" size={24} className={cn(refreshing && "animate-spin")} />
      </button>
      <button
        onClick={() => setLive((v: any) => !v)}
        title={live ? "Pause live" : "Resume live"}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border text-[11px] font-[510] transition-colors duration-100",
          live
            ? "border-emerald/30 bg-emerald/8 text-emerald"
            : "border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain",
        )}
      >
        <span className={cn("size-1.5 rounded-full", live ? "bg-emerald animate-pulse" : "bg-fog-grey")} />
        {live ? "Live" : "Paused"}
      </button>
      <button
        onClick={() => setAutoScroll((v: any) => !v)}
        title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border text-[11px] font-[510] transition-colors duration-100",
          autoScroll
            ? "border-aether-blue/30 bg-aether-blue/8 text-aether-blue"
            : "border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain",
        )}
      >
        <LucideIcon name="vertical_align_bottom" className="text-[13px]" />
        Auto-scroll
      </button>
      <button
        onClick={onClear}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border border-charcoal-grey text-[11px] text-storm-cloud hover:bg-warning-red/8 hover:border-warning-red/30 hover:text-warning-red transition-colors duration-100"
      >
        <LucideIcon name="delete" className="text-[13px]" />
        Clear
      </button>
    </div>
  );
}

function LogsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = searchParams.get("tab") || "request-logs";

  // RequestLogger lifted state
  const [sortBy, setSortBy] = useState("newest");
  const [recording, setRecording] = useState(true);
  const [filterProvider, setFilterProvider] = useState("all");
  const [providerOptions, setProviderOptions] = useState<any[]>([]);
  const [requestRefreshing, setRequestRefreshing] = useState(false);
  const refreshRef = useRef<any>(null);

  // ProxyLogsTab lifted state
  const [proxySortBy, setProxySortBy] = useState("newest");
  const [proxyLive, setProxyLive] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.sessionStorage.getItem("logsProxyLive");
    return stored === null ? true : stored === "true";
  });
  const [proxyCount, setProxyCount] = useState(0);
  const [proxyRefreshing, setProxyRefreshing] = useState(false);
  const proxyRefreshRef = useRef<any>(null);

  // ConsoleLogClient lifted state
  const [autoScroll, setAutoScroll] = useState(true);
  const [consoleLive, setConsoleLive] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.sessionStorage.getItem("logsConsoleLive");
    return stored === null ? true : stored === "true";
  });
  const [consoleRefreshing, setConsoleRefreshing] = useState(false);
  const clearRef = useRef<any>(null);
  const consoleRefreshRef = useRef<any>(null);

  // Persist live toggle states
  useEffect(() => {
    if (typeof window !== "undefined") window.sessionStorage.setItem("logsProxyLive", String(proxyLive));
  }, [proxyLive]);

  useEffect(() => {
    if (typeof window !== "undefined") window.sessionStorage.setItem("logsConsoleLive", String(consoleLive));
  }, [consoleLive]);

  const handleRequestRefresh = async () => {
    setRequestRefreshing(true);
    try {
      await refreshRef.current?.();
    } finally {
      setRequestRefreshing(false);
    }
  };
  const handleProxyRefresh = async () => {
    setProxyRefreshing(true);
    try {
      await proxyRefreshRef.current?.();
    } finally {
      setProxyRefreshing(false);
    }
  };
  const handleConsoleRefresh = async () => {
    setConsoleRefreshing(true);
    try {
      await consoleRefreshRef.current?.();
    } finally {
      setConsoleRefreshing(false);
    }
  };

  const setTab = (key: any) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Page header: tabs left, toolbar right */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Pill tabs */}
        <SegmentedControl
          options={TABS.map((tab: any) => ({ value: tab.key, label: tab.label, icon: tab.icon }))}
          value={activeTab}
          onChange={setTab}
          size="sm"
          iconSize={20}
          className="w-full sm:w-auto"
        />

        {/* Toolbar per tab */}
        {activeTab === "request-logs" && (
          <RequestLogsToolbar
            sortBy={sortBy}
            setSortBy={setSortBy}
            onRefresh={handleRequestRefresh}
            refreshing={requestRefreshing}
            recording={recording}
            setRecording={setRecording}
            filterProvider={filterProvider}
            setFilterProvider={setFilterProvider}
            providerOptions={providerOptions}
          />
        )}
        {activeTab === "proxy-logs" && (
          <ProxyLogsToolbar
            sortBy={proxySortBy}
            setSortBy={setProxySortBy}
            onRefresh={handleProxyRefresh}
            refreshing={proxyRefreshing}
            live={proxyLive}
            setLive={setProxyLive}
            count={proxyCount}
          />
        )}
        {activeTab === "console" && (
          <ConsoleToolbar
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            onClear={() => clearRef.current?.()}
            onRefresh={handleConsoleRefresh}
            refreshing={consoleRefreshing}
            live={consoleLive}
            setLive={setConsoleLive}
          />
        )}
      </div>

      {/* Tab content — all tabs always mounted to keep refs alive */}
      <div>
        <div className={activeTab === "request-logs" ? "" : "hidden"}>
          <RequestLogger
            sortBy={sortBy}
            setSortBy={setSortBy}
            recording={recording}
            setRecording={setRecording}
            refreshRef={refreshRef}
            filterProvider={filterProvider}
            setFilterProvider={setFilterProvider}
            onProvidersChange={setProviderOptions}
          />
        </div>
        <div className={activeTab === "proxy-logs" ? "" : "hidden"}>
          <ProxyLogsTab
            sortBy={proxySortBy}
            setSortBy={setProxySortBy}
            live={proxyLive}
            setLive={setProxyLive}
            onRefresh={proxyRefreshRef}
            onCountChange={setProxyCount}
          />
        </div>
        <div className={activeTab === "console" ? "" : "hidden"}>
          <ConsoleLogClient
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            clearRef={clearRef}
            live={consoleLive}
            refreshRef={consoleRefreshRef}
          />
        </div>
      </div>
    </div>
  );
}

export default function LogsClient() {
  return (
    <Suspense fallback={<div className="text-[12px] text-fog-grey">Loading...</div>}>
      <LogsInner />
    </Suspense>
  );
}
