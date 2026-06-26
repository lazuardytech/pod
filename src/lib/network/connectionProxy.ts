import { getProxyPoolById } from "@/models";
import { error as logError } from "@/sse/utils/logger";

// Safely normalize any value into a trimmed string.
function normalizeString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

type ProviderSpecificData = {
  connectionProxyEnabled?: unknown;
  connectionProxyUrl?: unknown;
  connectionNoProxy?: unknown;
  proxyPoolId?: unknown;
};

type LegacyProxy = {
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
};

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData: ProviderSpecificData = {}): LegacyProxy {
  const connectionProxyEnabled = providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(providerSpecificData?.connectionProxyUrl);

  const connectionNoProxy = normalizeString(providerSpecificData?.connectionNoProxy);

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

export type ConnectionProxyConfig = {
  source: "pool" | "vercel" | "legacy" | "none" | "error";
  proxyPoolId: string | null;
  proxyPool: unknown;
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
  strictProxy: boolean;
  vercelRelayUrl?: string;
  relayAuthToken?: string;
};

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData: ProviderSpecificData = {},
): Promise<ConnectionProxyConfig> {
  try {
    const proxyPoolIdRaw = normalizeString(providerSpecificData?.proxyPoolId);

    // "__none__" means explicitly disabled
    const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString((proxyPool as { proxyUrl?: unknown })?.proxyUrl);
      const noProxy = normalizeString((proxyPool as { noProxy?: unknown })?.noProxy);

      const isValidPool = proxyPool && (proxyPool as { isActive?: unknown }).isActive === true && proxyUrl;

      if (isValidPool) {
        const pool = proxyPool as {
          type?: string;
          strictProxy?: boolean;
          relayAuthToken?: string;
        };

        /**
         * Vercel relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (pool.type === "vercel") {
          return {
            source: "vercel",

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: pool.strictProxy === true,

            vercelRelayUrl: proxyUrl,
            relayAuthToken: normalizeString(pool.relayAuthToken),
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: pool.strictProxy === true,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        connectionProxyEnabled: legacy.connectionProxyEnabled,
        connectionProxyUrl: legacy.connectionProxyUrl,
        connectionNoProxy: legacy.connectionNoProxy,
        strictProxy: false,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      connectionProxyEnabled: legacy.connectionProxyEnabled,
      connectionProxyUrl: legacy.connectionProxyUrl,
      connectionNoProxy: legacy.connectionNoProxy,
      strictProxy: false,
    };
  } catch (error) {
    logError("resolveConnectionProxyConfig", "Failed to resolve proxy config", {
      error: (error as Error).message,
    });

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
    };
  }
}
