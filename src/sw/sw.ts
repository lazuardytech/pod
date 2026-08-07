/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope & typeof globalThis;

type PrecacheRouteResult =
  | { route: string; ok: true }
  | { route: string; ok: false; status?: number; error?: string };

function resolveVersion(): string {
  try {
    if (sw.location?.href) {
      const version = new URL(sw.location.href).searchParams.get("v");
      if (version) return version;
    }
  } catch {
    return "dev";
  }
  return "dev";
}

let SW_VERSION = resolveVersion();

// Cache names are keyed to the deploy/build hash (injected via the `?v=` query
// at registration time), NOT the release semver. A new deploy therefore gets its
// own cache namespace; `activate` evicts every prior namespace so a stale
// app-shell (which references old `_next/static` chunk hashes) is dropped.
function makeCacheNames(version: string): { shell: string; static: string; image: string } {
  return {
    shell: `pod-shell-cache-${version}`,
    static: `pod-static-cache-${version}`,
    image: `pod-image-cache-${version}`,
  };
}

let CACHE = makeCacheNames(SW_VERSION);

const OFFLINE_FALLBACK_URL = "/offline";
const IMAGE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 31;
// ponytail: 5s is enough — 15s made cold-start pain unbearable on idle Zeabur canary
const NAVIGATION_NETWORK_TIMEOUT_MS = 5000;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"];
const SENSITIVE_SEARCH_PARAMS = new Set([
  "code",
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "session",
]);

// ponytail: all 15 dashboard pages so alpha testers get instant nav everywhere
const SHELL_ROUTES = [
  "/",
  "/landing",
  "/login",
  "/endpoint",
  "/providers",
  "/media-providers",
  "/combos",
  "/quota",
  "/usage",
  "/memory",
  "/cache",
  "/health",
  "/logs",
  "/proxy-pools",
  "/settings",
  "/translator",
  "/basic-chat",
  OFFLINE_FALLBACK_URL,
];

const STATIC_PRECACHE = [
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/icon0.svg",
  "/apple-icon.png",
];

function isSameOrigin(url: URL): boolean {
  return url.origin === sw.location.origin;
}

function isImageRequest(request: Request, url: URL): boolean {
  if (request.destination === "image") return true;
  return IMAGE_EXTENSIONS.some((ext) => url.pathname.toLowerCase().endsWith(ext));
}

function isNavigationRequest(request: Request, url: URL): boolean {
  if (request.mode !== "navigate") return false;
  if (!isSameOrigin(url)) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

function isStaticAssetRequest(request: Request, url: URL): boolean {
  if (!isSameOrigin(url)) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;

  return (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "worker"
  );
}

function isFingerprintedAsset(url: URL): boolean {
  return url.pathname.startsWith("/_next/static/");
}

function isCacheableResponse(response: Response | undefined | null): response is Response {
  if (!response || !response.ok) return false;
  return response.type === "basic" || response.type === "default";
}

function responseAllowsStorage(response: Response): boolean {
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  return !cacheControl.includes("no-store");
}

function hasSensitiveQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_SEARCH_PARAMS.has(key.toLowerCase())) return true;
  }
  return false;
}

function emptyAssetResponse(url: URL): Response {
  const path = url.pathname.toLowerCase();
  const isJs = path.endsWith(".js") || path.endsWith(".mjs");
  return new Response("", {
    status: 200,
    headers: { "Content-Type": isJs ? "application/javascript" : "text/css" },
  });
}

function emptyImageResponse(url: URL): Response {
  const path = url.pathname.toLowerCase();
  let contentType = "image/png";
  if (path.endsWith(".svg")) contentType = "image/svg+xml";
  else if (path.endsWith(".webp")) contentType = "image/webp";
  else if (path.endsWith(".gif")) contentType = "image/gif";
  else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) contentType = "image/jpeg";
  else if (path.endsWith(".avif")) contentType = "image/avif";
  else if (path.endsWith(".ico")) contentType = "image/x-icon";
  return new Response("", {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

async function fetchWithTimeout(request: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function putWithTimestamp(cache: Cache, request: Request, response: Response): Promise<void> {
  const headers = new Headers(response.headers);
  headers.set("sw-cache-time", Date.now().toString());
  await cache.put(
    request,
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}

async function precacheShell(): Promise<{
  shellResults: PrecacheRouteResult[];
  staticResults: PrecacheRouteResult[];
  shellFailed: PrecacheRouteResult[];
  staticFailed: PrecacheRouteResult[];
}> {
  const shellCache = await caches.open(CACHE.shell);
  const staticCache = await caches.open(CACHE.static);

  const shellResults = await Promise.all(
    SHELL_ROUTES.map(async (route): Promise<PrecacheRouteResult> => {
      try {
        const response = await fetch(new Request(route, { cache: "reload" }));
        if (isCacheableResponse(response) && responseAllowsStorage(response)) {
          await shellCache.put(route, response);
          return { route, ok: true };
        }
        return { route, ok: false, status: response?.status ?? 0 };
      } catch (err) {
        return { route, ok: false, error: String(err) };
      }
    }),
  );

  const staticResults = await Promise.all(
    STATIC_PRECACHE.map(async (route): Promise<PrecacheRouteResult> => {
      try {
        const response = await fetch(new Request(route, { cache: "reload" }));
        if (isCacheableResponse(response) && responseAllowsStorage(response)) {
          await staticCache.put(route, response);
          return { route, ok: true };
        }
        return { route, ok: false, status: response?.status ?? 0 };
      } catch (err) {
        return { route, ok: false, error: String(err) };
      }
    }),
  );

  // Surface (do not swallow) any routes we failed to precache so the failure
  // is observable and correctable via warmShellCache on activate.
  const shellFailed = shellResults.filter((result) => !result.ok);
  const staticFailed = staticResults.filter((result) => !result.ok);

  if (shellFailed.length > 0) {
    console.warn(
      `[Pod SW] precacheShell: ${shellFailed.length}/${SHELL_ROUTES.length} shell routes not cached`,
      shellFailed,
    );
  }
  if (staticFailed.length > 0) {
    console.warn(
      `[Pod SW] precacheShell: ${staticFailed.length}/${STATIC_PRECACHE.length} static assets not cached`,
      staticFailed,
    );
  }

  return { shellResults, staticResults, shellFailed, staticFailed };
}

async function handleNavigationRequest(request: Request): Promise<Response> {
  try {
    const shellCache = await caches.open(CACHE.shell);
    const url = new URL(request.url);

    try {
      const response = await fetchWithTimeout(request, NAVIGATION_NETWORK_TIMEOUT_MS);
      if (
        isCacheableResponse(response) &&
        responseAllowsStorage(response) &&
        !hasSensitiveQuery(url)
      ) {
        try {
          await shellCache.put(request, response.clone());
        } catch {
          // Quota or put failure — still serve the network response.
        }
      }
      return response;
    } catch {
      const cached = await shellCache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      const fallback = await shellCache.match(OFFLINE_FALLBACK_URL);
      if (fallback) return fallback;

      return new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  } catch {
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function handleStaticAssetRequest(request: Request, url: URL): Promise<Response> {
  const staticCache = await caches.open(CACHE.static);
  const cached = await staticCache.match(request);

  if (!isFingerprintedAsset(url)) {
    try {
      const response = await fetch(request);
      if (isCacheableResponse(response) && responseAllowsStorage(response)) {
        await staticCache.put(request, response.clone());
      }
      return response;
    } catch {
      // Graceful fallback: serve any cached copy, else an empty module, instead
      // of a synthetic Response.error() (which surfaces to the page as net::ERR_FAILED).
      return cached || emptyAssetResponse(url);
    }
  }

  const networkFetch = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response) && responseAllowsStorage(response)) {
        await staticCache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkFetch.catch(() => {});
    return cached;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;

  // Graceful fallback: a missing post-deploy chunk returns an empty module
  // rather than Response.error(), so the page degrades instead of hard-failing.
  return cached || emptyAssetResponse(url);
}

async function handleImageRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const imageCache = await caches.open(CACHE.image);
  const cached = await imageCache.match(request);

  if (cached) {
    const cacheTime = Number(cached.headers.get("sw-cache-time") || 0);
    if (Date.now() - cacheTime < IMAGE_MAX_AGE_MS) return cached;
  }

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response) && responseAllowsStorage(response)) {
      await putWithTimestamp(imageCache, request, response.clone());
    }
    return response;
  } catch {
    if (cached) return cached;
    return emptyImageResponse(url);
  }
}

async function purgeExpiredImages(): Promise<void> {
  const imageCache = await caches.open(CACHE.image);
  const requests = await imageCache.keys();

  await Promise.all(
    requests.map(async (request) => {
      const cached = await imageCache.match(request);
      if (!cached) return;
      const cacheTime = Number(cached.headers.get("sw-cache-time") || 0);
      if (
        !Number.isFinite(cacheTime) ||
        cacheTime <= 0 ||
        Date.now() - cacheTime > IMAGE_MAX_AGE_MS
      ) {
        await imageCache.delete(request);
      }
    }),
  );
}

async function warmShellCache(): Promise<void> {
  // ponytail: on activate, proactively (re)fill shell routes. Always overwrites
  // existing entries so a stale same-version shell is corrected after a deploy.
  const shellCache = await caches.open(CACHE.shell);
  await Promise.all(
    SHELL_ROUTES.map(async (route) => {
      try {
        const response = await fetch(new Request(route));
        if (isCacheableResponse(response) && responseAllowsStorage(response)) {
          await shellCache.put(route, response);
        }
      } catch {
        // Best-effort warming — failures at this point are fine
      }
    }),
  );
}

function registerServiceWorker(): void {
  if (typeof sw === "undefined" || typeof sw.addEventListener !== "function") return;

  sw.addEventListener("install", (event) => {
    // ponytail: skipWaiting so canary users don't need to hard-reload for updated SW
    sw.skipWaiting();
    event.waitUntil(
      (async () => {
        const result = await precacheShell();
        if (result.shellFailed.length > 0) {
          console.warn(
            "[Pod SW] install precache incomplete — warmShellCache will retry on activate",
          );
        }
      })(),
    );
  });

  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const expected = new Set([CACHE.shell, CACHE.static, CACHE.image]);
        const keys = await caches.keys();
        // Evict every prior deploy's cache namespace so a stale app-shell
        // (old `_next/static` chunk hashes) is dropped on update.
        await Promise.all(
          keys.filter((key) => !expected.has(key)).map((key) => caches.delete(key)),
        );
        await purgeExpiredImages();
        await sw.clients.claim();
        // ponytail: warm after claim so first navigation isn't blocked
        void warmShellCache();
      })(),
    );
  });

  sw.addEventListener("message", (_event) => {
    // Reserved for future use. No auto-update message handling.
  });

  sw.addEventListener("fetch", (event: FetchEvent) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (!isSameOrigin(url)) return;

    if (isNavigationRequest(request, url)) {
      event.respondWith(handleNavigationRequest(request));
      return;
    }

    if (isStaticAssetRequest(request, url)) {
      event.respondWith(handleStaticAssetRequest(request, url));
      return;
    }

    if (isImageRequest(request, url)) {
      event.respondWith(handleImageRequest(request));
    }
  });
}

registerServiceWorker();

// Exposed for unit tests (vitest) in a Node context. Guarded so it is a no-op
// in the browser service-worker runtime where `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    resolveVersion,
    makeCacheNames,
    getCache: () => CACHE,
    getVersion: () => SW_VERSION,
    isNavigationRequest,
    isStaticAssetRequest,
    isImageRequest,
    isFingerprintedAsset,
    handleNavigationRequest,
    handleStaticAssetRequest,
    handleImageRequest,
    precacheShell,
    warmShellCache,
    SHELL_ROUTES,
    STATIC_PRECACHE,
    setVersionForTest: (version: string) => {
      SW_VERSION = version;
      CACHE = makeCacheNames(version);
    },
  };
}
