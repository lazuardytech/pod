// Generated from src/sw/sw.ts by scripts/build-sw.ts; do not edit.
const sw = self;
function resolveVersion() {
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
function makeCacheNames(version) {
  return {
    shell: `pod-shell-cache-${version}`,
    static: `pod-static-cache-${version}`,
    image: `pod-image-cache-${version}`,
  };
}
let CACHE = makeCacheNames(SW_VERSION);
const OFFLINE_FALLBACK_URL = "/offline";
const IMAGE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 31;
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
function isSameOrigin(url) {
  return url.origin === sw.location.origin;
}
function isImageRequest(request, url) {
  if (request.destination === "image") return true;
  return IMAGE_EXTENSIONS.some((ext) => url.pathname.toLowerCase().endsWith(ext));
}
function isNavigationRequest(request, url) {
  if (request.mode !== "navigate") return false;
  if (!isSameOrigin(url)) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}
function isStaticAssetRequest(request, url) {
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
function isFingerprintedAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}
function isCacheableResponse(response) {
  if (!response || !response.ok) return false;
  return response.type === "basic" || response.type === "default";
}
function responseAllowsStorage(response) {
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  return !cacheControl.includes("no-store");
}
function hasSensitiveQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_SEARCH_PARAMS.has(key.toLowerCase())) return true;
  }
  return false;
}
function emptyAssetResponse(url) {
  const path = url.pathname.toLowerCase();
  const isJs = path.endsWith(".js") || path.endsWith(".mjs");
  return new Response("", {
    status: 200,
    headers: { "Content-Type": isJs ? "application/javascript" : "text/css" },
  });
}
function emptyImageResponse(url) {
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
async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
async function putWithTimestamp(cache, request, response) {
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
async function precacheShell() {
  const shellCache = await caches.open(CACHE.shell);
  const staticCache = await caches.open(CACHE.static);
  const shellResults = await Promise.all(
    SHELL_ROUTES.map(async (route) => {
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
    STATIC_PRECACHE.map(async (route) => {
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
async function handleNavigationRequest(request) {
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
        } catch {}
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
async function handleStaticAssetRequest(request, url) {
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
  return cached || emptyAssetResponse(url);
}
async function handleImageRequest(request) {
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
async function purgeExpiredImages() {
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
async function warmShellCache() {
  const shellCache = await caches.open(CACHE.shell);
  await Promise.all(
    SHELL_ROUTES.map(async (route) => {
      try {
        const response = await fetch(new Request(route));
        if (isCacheableResponse(response) && responseAllowsStorage(response)) {
          await shellCache.put(route, response);
        }
      } catch {}
    }),
  );
}
function registerServiceWorker() {
  if (typeof sw === "undefined" || typeof sw.addEventListener !== "function") return;
  sw.addEventListener("install", (event) => {
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
        await Promise.all(
          keys.filter((key) => !expected.has(key)).map((key) => caches.delete(key)),
        );
        await purgeExpiredImages();
        await sw.clients.claim();
        warmShellCache();
      })(),
    );
  });
  sw.addEventListener("message", (_event) => {});
  sw.addEventListener("fetch", (event) => {
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
    setVersionForTest: (version) => {
      SW_VERSION = version;
      CACHE = makeCacheNames(version);
    },
  };
}
