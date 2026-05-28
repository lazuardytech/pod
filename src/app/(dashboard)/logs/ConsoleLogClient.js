"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { cn } from "@/shared/utils/cn";

const LEVEL_RE = /\[(LOG|INFO|WARN|ERROR|DEBUG)\]/i;

const LEVEL_STYLES = {
  LOG: { badge: "bg-emerald/10 text-emerald border-emerald/20", text: "text-emerald" },
  INFO: { badge: "bg-aether-blue/10 text-aether-blue border-aether-blue/20", text: "text-aether-blue" },
  WARN: { badge: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20", text: "text-[#f59e0b]" },
  ERROR: { badge: "bg-warning-red/10 text-warning-red border-warning-red/20", text: "text-warning-red" },
  DEBUG: { badge: "bg-amethyst/10 text-amethyst border-amethyst/20", text: "text-amethyst" },
};

const LEVEL_ORDER = { DEBUG: 0, LOG: 1, INFO: 2, WARN: 3, ERROR: 4 };

function parseLevel(line) {
  const m = line.match(LEVEL_RE);
  return m ? m[1].toUpperCase() : "LOG";
}

function parseTimestamp(line) {
  const m = line.match(/^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]/);
  return m ? m[1] : null;
}

function nowTs() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function wrapLine(line) {
  return typeof line === "string" ? { line, receivedAt: nowTs() } : line;
}

function stripLevel(line) {
  return line.replace(LEVEL_RE, "").trim();
}

function LogLine({ entry, idx, onCopy, copied }) {
  const line = typeof entry === "string" ? entry : entry.line;
  const receivedAt = typeof entry === "object" ? entry.receivedAt : null;
  const level = parseLevel(line);
  const ts = parseTimestamp(line) || receivedAt || "—";
  const style = LEVEL_STYLES[level] || LEVEL_STYLES.LOG;
  const text = stripLevel(line);

  return (
    <div className="group flex items-start gap-2 px-3 py-1 rounded-[4px] hover:bg-porcelain/4 transition-colors duration-75">
      <span className="shrink-0 text-[10px] text-fog-grey font-mono mt-0.5 w-[66px]">{ts}</span>
      <span
        className={cn(
          "shrink-0 inline-flex items-center px-1 py-0.5 rounded-[3px] border text-[9px] font-[590] uppercase tracking-[0.05em] mt-0.5 w-[42px] justify-center",
          style.badge,
        )}
      >
        {level}
      </span>
      <span className={cn("flex-1 text-[11px] font-mono leading-[1.6] break-all", style.text)}>{text}</span>
      <button
        onClick={() => onCopy(line, idx)}
        className="shrink-0 opacity-0 group-hover:opacity-100 flex items-center justify-center size-5 rounded-[3px] text-fog-grey hover:text-porcelain hover:bg-deep-slate transition-all duration-100"
        title="Copy line"
      >
        <span className="material-symbols-outlined text-[12px]">{copied === idx ? "check" : "content_copy"}</span>
      </button>
    </div>
  );
}

const LEVEL_FILTERS = [
  { key: "all", label: "All" },
  { key: "DEBUG", label: "Debug" },
  { key: "INFO", label: "Info" },
  { key: "WARN", label: "Warn" },
  { key: "ERROR", label: "Error" },
];

export default function ConsoleLogClient({ autoScroll, setAutoScroll, clearRef, live = true, refreshRef }) {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [levelFilter, setLevelFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const scrollRef = useRef(null);
  const esRef = useRef(null);
  const liveRef = useRef(live);

  // Keep liveRef in sync
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const handleClear = useCallback(async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      setLogs([]);
    } catch {}
  }, []);

  const handleRefresh = useCallback(async () => {
    try {
      const res = await fetch("/api/translator/console-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs((data.logs || []).slice(-CONSOLE_LOG_CONFIG.maxLines).map(wrapLine));
        setLastUpdated(new Date());
      }
    } catch {}
  }, []);

  // Expose clear and refresh to parent via refs
  useEffect(() => {
    if (clearRef) clearRef.current = handleClear;
  }, [clearRef, handleClear]);

  useEffect(() => {
    if (refreshRef) refreshRef.current = handleRefresh;
  }, [refreshRef, handleRefresh]);

  const handleCopy = useCallback((line, idx) => {
    navigator.clipboard?.writeText(line).catch(() => {});
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setLastUpdated(new Date());
    };

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines).map(wrapLine));
        setLastUpdated(new Date());
        // Scroll to bottom after initial load
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        });
      } else if (msg.type === "line") {
        if (!liveRef.current) return;
        setLogs((prev) => {
          const next = [...prev, wrapLine(msg.line)];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
        setLastUpdated(new Date());
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = logs.filter((entry) => {
    const line = typeof entry === "string" ? entry : entry.line;
    const level = parseLevel(line);
    if (levelFilter !== "all") {
      const minOrder = LEVEL_ORDER[levelFilter.toUpperCase()] ?? 0;
      if ((LEVEL_ORDER[level] ?? 0) < minOrder) return false;
    }
    if (search) return line.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const counts = {
    total: logs.length,
    error: logs.filter((e) => parseLevel(typeof e === "string" ? e : e.line) === "ERROR").length,
    warn: logs.filter((e) => parseLevel(typeof e === "string" ? e : e.line) === "WARN").length,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Row 2: Search + Level filter pills + Stats */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Search + filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-fog-grey">
              search
            </span>
            <input
              aria-label="Search console logs"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search console logs..."
              className="w-full h-7 pl-9 pr-3 rounded-[6px] border border-charcoal-grey bg-deep-slate text-[12px] text-porcelain placeholder:text-fog-grey focus:outline-none focus:border-porcelain/30 transition-colors duration-100"
              name="search"
            />
          </div>
          <div className="flex items-center gap-1">
            {LEVEL_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setLevelFilter(f.key)}
                className={cn(
                  "h-6 px-2.5 rounded-[4px] text-[11px] font-[510] transition-colors duration-100",
                  levelFilter === f.key
                    ? "bg-porcelain/10 text-porcelain border border-porcelain/20"
                    : "text-fog-grey hover:text-storm-cloud hover:bg-deep-slate border border-transparent",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Connection status + Stats */}
        <div className="flex items-center gap-2 text-[11px] shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", connected ? "bg-emerald animate-pulse" : "bg-warning-red")} />
            <span className={connected ? "text-emerald" : "text-warning-red"}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-fog-grey">
            <span>{counts.total} lines</span>
            {counts.error > 0 && <span className="text-warning-red">{counts.error} errors</span>}
            {counts.warn > 0 && <span className="text-[#f59e0b]">{counts.warn} warnings</span>}
            {lastUpdated && <span className="text-fog-grey/60">{lastUpdated.toLocaleTimeString()}</span>}
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className="h-[70vh] rounded-[6px] border border-charcoal-grey bg-pitch-black overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-charcoal-grey bg-graphite shrink-0">
          <span className="text-[11px] text-fog-grey font-mono">console — pod</span>
          <span className="ml-auto text-[10px] text-fog-grey">
            {filtered.length} / {logs.length} lines
          </span>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto custom-scrollbar py-2"
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            if (!atBottom && autoScroll) setAutoScroll(false);
          }}
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-fog-grey">
              <span className="material-symbols-outlined text-[28px]">terminal</span>
              <p className="text-[12px]">
                {logs.length === 0 ? "No console logs yet." : "No logs match your filters."}
              </p>
            </div>
          ) : (
            filtered.map((entry, i) => <LogLine key={i} entry={entry} idx={i} onCopy={handleCopy} copied={copied} />)
          )}
        </div>
      </div>
      <p className="text-[10px] text-fog-grey italic">
        Showing {filtered.length} of {logs.length} logs
      </p>
    </div>
  );
}
