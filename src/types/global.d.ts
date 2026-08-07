// Runtime-injected globals (declared by server-init.js / initializeApp.js).
// `removeAllDNSEntriesSync` is provided by the Cloudflare/edge runtime when
// the server runs in cloud mode; it has no Node counterpart.

declare global {
  var __appSingleton:
    | {
        signalHandlersRegistered: boolean;
        watchdogInterval: ReturnType<typeof setInterval> | null;
        networkMonitorInterval: ReturnType<typeof setInterval> | null;
        lastNetworkFingerprint: string | null;
        lastWatchdogTick: number;
      }
    | undefined;

  var __cloudSyncInit:
    | {
        initialized: boolean;
        inProgress: Promise<boolean> | null;
      }
    | undefined;

  var __modelsDevSync:
    | {
        timer: ReturnType<typeof setInterval> | null;
        lastSync: string | null;
        lastSyncModelCount: number;
        intervalMs: number;
        syncPromise: Promise<unknown> | null;
      }
    | undefined;

  var _consoleLogBufferState:
    | {
        logs: string[];
        patched: boolean;
        originals: Record<string, (...args: unknown[]) => void>;
        emitter: import("node:events").EventEmitter;
      }
    | undefined;

  var _pendingRequests:
    | {
        byModel: Record<string, number>;
        byAccount: Record<string, Record<string, number>>;
      }
    | undefined;

  var _lastErrorProvider: { provider: string; ts: number } | undefined;
  var _statsEmitter: import("node:events").EventEmitter | undefined;
  var _pendingTimers: Record<string, ReturnType<typeof setTimeout>[]> | undefined;
  var _summaryQueue: unknown[] | undefined;
  var _logQueue: unknown[] | undefined;
  var _flushHooksRegistered: boolean | undefined;
  var __podRequestDetailsShutdownHandler: (() => Promise<void>) | undefined;

  // Cloudflare Workers Cache Storage API is only present at runtime in cloud
  // mode. DOM lib already declares `var caches: CacheStorage` — do not
  // redeclare as `any`. Cloud detection uses `typeof caches !== "undefined"`.

  function removeAllDNSEntriesSync(): void;
}

// Augment React HTML attributes for Next.js styled-jsx support
// The `jsx` and `global` attributes on <style> are custom attributes used
// by Next.js built-in styled-jsx for scoped CSS.
import "react";

declare module "react" {
  interface StyleHTMLAttributes<T> {
    jsx?: boolean;
    global?: boolean;
  }
}

export {};
