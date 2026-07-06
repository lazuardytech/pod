import { EventEmitter } from "node:events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const consoleLevels = ["log", "info", "warn", "error", "debug"] as const;

type ConsoleLevel = (typeof consoleLevels)[number];

type ConsoleLogBufferState = {
  logs: string[];
  patched: boolean;
  originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>>;
  emitter: EventEmitter;
};

declare global {
  // eslint-disable-next-line no-var
  var _consoleLogBufferState: ConsoleLogBufferState | undefined;
}

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state: ConsoleLogBufferState = global._consoleLogBufferState;

// Ensure emitter exists (handles hot reload with stale global)
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

function toLogLine(level: ConsoleLevel, args: unknown[]): string {
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

function appendLine(line: string): void {
  state.logs.push(line);
  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }
  state.emitter.emit("line", line);
}

export function initConsoleLogCapture(): void {
  if (state.patched) return;

  for (const level of consoleLevels) {
    const original = console[level].bind(console) as (...args: unknown[]) => void;
    state.originals[level] = original;
    (console as unknown as Record<ConsoleLevel, (...args: unknown[]) => void>)[level] = (
      ...args: unknown[]
    ) => {
      appendLine(toLogLine(level, args));
      original(...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs(): string[] {
  return state.logs;
}

export function clearConsoleLogs(): void {
  state.logs = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter(): EventEmitter {
  return state.emitter;
}
