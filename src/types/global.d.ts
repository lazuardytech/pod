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

  function removeAllDNSEntriesSync(): void;
}

export {};
