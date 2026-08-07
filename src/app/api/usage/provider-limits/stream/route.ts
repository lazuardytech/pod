import { parseQuotaData } from "@/app/(dashboard)/usage/components/ProviderLimits/utils";
import { getProviderConnections } from "@/lib/localDb";
import { sanitizeError } from "@/lib/sanitizeError";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { releaseSSESlot, tryAcquireSSESlot } from "../../../monitoring/_sseConnectionCap";
export const dynamic = "force-dynamic";

const ROUTE_PATH = "/api/usage/provider-limits/stream";
const POLL_MS = 60000;
const HEARTBEAT_MS = 25000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const isUsageEligible = (conn: {
  provider?: string;
  accessToken?: string;
  apiKey?: string;
  authType?: string;
}) =>
  USAGE_SUPPORTED_PROVIDERS.includes(String(conn.provider ?? "")) &&
  (conn.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(String(conn.provider ?? "")));

async function buildProviderLimitsSnapshot(request: Request) {
  const connections = await getProviderConnections();
  const quotaData: Record<
    string,
    { quotas: unknown[]; plan?: unknown; message?: string; raw?: unknown }
  > = {};
  const errors: Record<string, string> = {};
  const usageUrlBase = new URL(request.url);
  const cookie = request.headers.get("cookie");
  const auth = request.headers.get("authorization");
  const apiKey = request.headers.get("x-api-key");

  await Promise.all(
    connections.filter(isUsageEligible).map(async (conn) => {
      try {
        const headers: Record<string, string> = { "x-pod-no-cache": "true" };
        if (cookie) headers.cookie = cookie;
        if (auth) headers.authorization = auth;
        if (apiKey) headers["x-api-key"] = apiKey;

        const response = await fetch(new URL(`/api/usage/${conn.id}`, usageUrlBase), {
          cache: "no-store",
          headers,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error || response.statusText;

          if (response.status === 404) return;

          if (response.status === 401) {
            quotaData[conn.id] = {
              quotas: [],
              message: errorMsg,
            };
            return;
          }

          errors[conn.id] = `HTTP ${response.status}: ${errorMsg}`;
          return;
        }

        const data = await response.json();
        quotaData[conn.id] = {
          quotas: parseQuotaData(conn.provider, data),
          plan: data.plan || null,
          message: data.message || null,
          raw: data,
        };
      } catch (error) {
        errors[conn.id] = sanitizeError(error) || "Failed to fetch quota";
      }
    }),
  );

  return {
    connections,
    quotaData,
    errors,
    timestamp: new Date().toISOString(),
  };
}

/**
 * GET /api/usage/provider-limits/stream
 * SSE stream for provider quota snapshot updates.
 */
export async function GET(request: Request) {
  const slot = tryAcquireSSESlot(ROUTE_PATH);
  if (!slot.allowed) return slot.response;

  let closed = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSig = "";
  const encoder = new TextEncoder();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (poll) clearInterval(poll);
    if (heartbeat) clearInterval(heartbeat);
    if (idleTimeout) clearTimeout(idleTimeout);
    releaseSSESlot(ROUTE_PATH);
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {}
      };

      const pushSnapshot = async (force = false) => {
        if (closed) return;
        try {
          const payload = await buildProviderLimitsSnapshot(request);
          const sig = JSON.stringify(payload);
          if (force || sig !== lastSig) {
            lastSig = sig;
            send(payload);
          }
        } catch (error) {
          send({ error: sanitizeError(error) || "Failed to load provider limits snapshot" });
        }
      };

      await pushSnapshot(true);

      poll = setInterval(() => {
        pushSnapshot(false).catch(() => {});
      }, POLL_MS);

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {}
      }, HEARTBEAT_MS);

      idleTimeout = setTimeout(() => cleanup(), IDLE_TIMEOUT_MS);

      request.signal.addEventListener(
        "abort",
        () => {
          cleanup();
        },
        { once: true },
      );

      return cleanup;
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
