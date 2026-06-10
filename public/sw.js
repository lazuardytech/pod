const SW_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";

const SHELL_CACHE_NAME = `pod-shell-cache-${SW_VERSION}`;
const STATIC_CACHE_NAME = `pod-static-cache-${SW_VERSION}`;
const IMAGE_CACHE_NAME = `pod-image-cache-${SW_VERSION}`;

const OFFLINE_FALLBACK_URL = "/offline";
const IMAGE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 31;
const NAVIGATION_NETWORK_TIMEOUT_MS = 15000;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"];
const SENSITIVE_SEARCH_PARAMS = new Set(["code", "token", "access_token", "id_token", "refresh_token", "session"]);

const SHELL_ROUTES = [
  "/",
  "/landing",
  "/login",
  "/endpoint",
  "/providers",
  "/usage",
  "/settings",
  OFFLINE_FALLBACK_URL,
];

const STATIC_PRECACHE = [
  "/manifest.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/icon0.svg",
  "/apple-icon.png",
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
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
  const shellCache = await caches.open(SHELL_CACHE_NAME);
  const staticCache = await caches.open(STATIC_CACHE_NAME);

  let cachedCount = 0;

  await Promise.all(
    SHELL_ROUTES.map(async (route) => {
      try {
        const response = await fetch(new Request(route, { cache: "reload" }));
        if (isCacheableResponse(response) && responseAllowsStorage(response)) {
          await shellCache.put(route, response);
          cachedCount++;
        }
      } catch {
        // Ignore individual failures
      }
    }),
  );

  await Promise.all(
    STATIC_PRECACHE.map(async (route) => {
      try {
        const response = await fetch(new Request(route, { cache: "reload" }));
        if (isCacheableResponse(response) && responseAllowsStorage(response)) {
          await staticCache.put(route, response);
        }
      } catch {
        // Ignore static precache failures.
      }
    }),
  );

  if (cachedCount === 0) {
    console.warn("[Pod SW] No shell routes cached — offline fallback will be empty");
  }
}

async function handleNavigationRequest(request) {
  const shellCache = await caches.open(SHELL_CACHE_NAME);
  const url = new URL(request.url);

  try {
    const response = await fetchWithTimeout(request, NAVIGATION_NETWORK_TIMEOUT_MS);
    if (isCacheableResponse(response) && responseAllowsStorage(response) && !hasSensitiveQuery(url)) {
      await shellCache.put(request, response.clone());
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
}

async function handleStaticAssetRequest(request, url) {
  const staticCache = await caches.open(STATIC_CACHE_NAME);
  const cached = await staticCache.match(request);

  if (!isFingerprintedAsset(url)) {
    try {
      const response = await fetch(request);
      if (isCacheableResponse(response) && responseAllowsStorage(response)) {
        await staticCache.put(request, response.clone());
      }
      return response;
    } catch {
      if (cached) return cached;
      return Response.error();
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

  return Response.error();
}

async function handleImageRequest(request) {
  const imageCache = await caches.open(IMAGE_CACHE_NAME);
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
    return Response.error();
  }
}

async function purgeExpiredImages() {
  const imageCache = await caches.open(IMAGE_CACHE_NAME);
  const requests = await imageCache.keys();

  await Promise.all(
    requests.map(async (request) => {
      const cached = await imageCache.match(request);
      if (!cached) return;
      const cacheTime = Number(cached.headers.get("sw-cache-time") || 0);
      if (!Number.isFinite(cacheTime) || cacheTime <= 0 || Date.now() - cacheTime > IMAGE_MAX_AGE_MS) {
        await imageCache.delete(request);
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheShell();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const expected = new Set([SHELL_CACHE_NAME, STATIC_CACHE_NAME, IMAGE_CACHE_NAME]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !expected.has(key)).map((key) => caches.delete(key)));
      await purgeExpiredImages();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (_event) => {
  // Reserved for future use. No auto-update message handling.
});

self.addEventListener("fetch", (event) => {
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
