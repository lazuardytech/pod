"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import RequestLogger from "@/shared/components/RequestLogger";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { cn } from "@/shared/utils/cn";
import ConsoleLogClient from "./ConsoleLogClient";
import ProxyLogsTab from "./ProxyLogsTab";

const TABS = [
  { key: "request-logs", label: "Request Logs", icon: "receipt_long" },
  { key: "proxy-logs", label: "Proxy Logs", icon: "lan" },
  { key: "console", label: "Console Logs", icon: "terminal" },
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
}) {
  return (
    <div className="flex items-center gap-2">
      {providerOptions.length > 0 && (
        <select
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className="h-7 px-2 rounded-[6px] border border-charcoal-grey bg-deep-slate text-[12px] text-porcelain focus:outline-none focus:border-porcelain/30 transition-colors duration-100 w-[130px]"
          name="filter-provider"
        >
          <option value="all">All Providers</option>
          {providerOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        className="h-7 px-2 rounded-[6px] border border-charcoal-grey bg-deep-slate text-[12px] text-porcelain focus:outline-none focus:border-porcelain/30 transition-colors duration-100 w-[120px]"
        name="sort-by"
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="tokens_desc">Most tokens</option>
        <option value="tokens_asc">Fewest tokens</option>
      </select>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Refresh"
      >
        <span className={cn("material-symbols-outlined text-[15px]", refreshing && "animate-spin")}>refresh</span>
      </button>
      <button
        onClick={() => setRecording((v) => !v)}
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

function ProxyLogsToolbar({ sortBy, setSortBy, onRefresh, refreshing, live, setLive, count }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-fog-grey">{count} configured</span>
      <div className="w-px h-4 bg-charcoal-grey" />
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        className="h-7 px-2 rounded-[6px] border border-charcoal-grey bg-deep-slate text-[12px] text-porcelain focus:outline-none focus:border-porcelain/30 transition-colors duration-100 w-[120px]"
        name="sort-by"
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Refresh"
      >
        <span className={cn("material-symbols-outlined text-[15px]", refreshing && "animate-spin")}>refresh</span>
      </button>
      <button
        onClick={() => setLive((v) => !v)}
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

function ConsoleToolbar({ autoScroll, setAutoScroll, onClear, onRefresh, refreshing, live, setLive }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Refresh"
      >
        <span className={cn("material-symbols-outlined text-[15px]", refreshing && "animate-spin")}>refresh</span>
      </button>
      <button
        onClick={() => setLive((v) => !v)}
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
        onClick={() => setAutoScroll((v) => !v)}
        title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border text-[11px] font-[510] transition-colors duration-100",
          autoScroll
            ? "border-aether-blue/30 bg-aether-blue/8 text-aether-blue"
            : "border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain",
        )}
      >
        <span className="material-symbols-outlined text-[13px]">vertical_align_bottom</span>
        Auto-scroll
      </button>
      <button
        onClick={onClear}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border border-charcoal-grey text-[11px] text-storm-cloud hover:bg-warning-red/8 hover:border-warning-red/30 hover:text-warning-red transition-colors duration-100"
      >
        <span className="material-symbols-outlined text-[13px]">delete</span>
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
  const [providerOptions, setProviderOptions] = useState([]);
  const [requestRefreshing, setRequestRefreshing] = useState(false);
  const refreshRef = useRef(null);

  // ProxyLogsTab lifted state
  const [proxySortBy, setProxySortBy] = useState("newest");
  const [proxyLive, setProxyLive] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.sessionStorage.getItem("logsProxyLive");
    return stored === null ? true : stored === "true";
  });
  const [proxyCount, setProxyCount] = useState(0);
  const [proxyRefreshing, setProxyRefreshing] = useState(false);
  const proxyRefreshRef = useRef(null);

  // ConsoleLogClient lifted state
  const [autoScroll, setAutoScroll] = useState(true);
  const [consoleLive, setConsoleLive] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.sessionStorage.getItem("logsConsoleLive");
    return stored === null ? true : stored === "true";
  });
  const [consoleRefreshing, setConsoleRefreshing] = useState(false);
  const clearRef = useRef(null);
  const consoleRefreshRef = useRef(null);

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

  const setTab = (key) => {
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
          options={TABS.map((tab) => ({ value: tab.key, label: tab.label, icon: tab.icon }))}
          value={activeTab}
          onChange={setTab}
          size="sm"
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
