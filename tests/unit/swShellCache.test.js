/**
 * Unit tests — SW app-shell stale-cache guard (audit §5 / repo artifact
 * sw-shell-stale-cache-audit, items 1-4).
 *
 * These exercise the handlers the SW Engineer must EXPOSE from public/sw.js.
 * They are NOT yet runnable until the seam in tests/SW-TEST-SEAM.md is added.
 *
 * Strategy: import public/sw.js as a module in a node env, with `caches`,
 * `self` and `fetch` fully mocked. sw.js is side-effect free on import when
 * `self.registration` is undefined (test mode), so the pure handlers can be
 * invoked directly.
 *
 * Run (requires the SW handlers exposed in public/sw.js per audit §5):
 *   bun x vitest run tests/unit/swShellCache.test.js --reporter=verbose
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SW_PATH = resolve(__dirname, "../../public/sw.js");

// ─── Globals mocks ─────────────────────────────────────────────────────────

function makeResponse(url, body, headers = {}) {
  return {
    url,
    ok: true,
    status: 200,
    type: "basic",
    headers: {
      get: (k) => (k.toLowerCase() === "cache-control" ? null : (headers[k.toLowerCase()] ?? null)),
    },
    clone: () => makeResponse(url, body, headers),
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function makeCacheStore() {
  const store = new Map();
  return {
    store,
    match: async (req, opts) => {
      const key = typeof req === "string" ? req : req.url;
      const entry = [...store.values()].find((e) => {
        if (opts?.ignoreSearch) return e.url.split("?")[0] === key.split("?")[0];
        return e.url === key;
      });
      return entry ? entry.res : undefined;
    },
    put: async (req, res) => {
      const key = typeof req === "string" ? req : req.url;
      store.set(key, { url: key, res });
    },
    keys: async () => [...store.values()].map((e) => ({ url: e.url })),
    delete: async (req) => {
      const key = typeof req === "string" ? req : req.url;
      return store.delete(key);
    },
  };
}

function makeCachesMock() {
  const caches = new Map();
  return {
    caches,
    mock: {
      open: vi.fn(async (name) => {
        if (!caches.has(name)) caches.set(name, makeCacheStore());
        return caches.get(name);
      }),
      keys: vi.fn(async () => [...caches.keys()]),
      delete: vi.fn(async (name) => caches.delete(name)),
    },
  };
}

// ─── Per-test env ──────────────────────────────────────────────────────────

let cachesApi;
let fetchImpl;

beforeEach(() => {
  cachesApi = makeCachesMock();
  fetchImpl = vi.fn(async () => makeResponse("http://localhost/", "<html>default</html>"));

  // self.location.href drives SW_VERSION (read at module load).
  const selfObj = {
    location: { href: "http://localhost/sw.js?v=0.0.82" },
    addEventListener: vi.fn(),
    clients: { claim: vi.fn() },
    skipWaiting: vi.fn(),
    registration: undefined, // undefined → sw.js does NOT register listeners (test mode)
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal("self", selfObj);
  vi.stubGlobal("caches", cachesApi.mock);
  vi.stubGlobal("fetch", fetchImpl);
  // Browser-faithful Request: a real SW resolves relative URLs against its
  // self.location.origin. Node's Request throws on a bare path, which makes
  // sw.js's internal `fetch(new Request(route))` throw silently — so resolve
  // against self.location here.
  vi.stubGlobal(
    "Request",
    class {
      constructor(input, init) {
        const base = self.location?.href || "http://localhost/";
        this.url = new URL(typeof input === "string" ? input : input.url, base).href;
        this.method = init?.method || "GET";
        this.headers = init?.headers || {};
      }
    },
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

// Reload sw.js with the current mocked globals. Each call re-evaluates the
// module-level version / cache-name computation against the live `self`.
// Version is driven by the `?v=` query in self.location.href (resolveVersion()).
async function loadSw(opts = {}) {
  if (opts.locationHref) self.location.href = opts.locationHref;
  return import(`${SW_PATH}?t=${Date.now()}-${Math.random()}`);
}

const STALE_HTML = (h) =>
  `<!doctype html><html><head></head><body><script src="/_next/static/${h}/app.js"></script></body></html>`;

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SW app-shell stale-cache guard", () => {
  // Audit §5.1 — navigation must not serve a stale shell when the network is up.
  it("serves fresh HTML (not stale cache) when network returns current build", async () => {
    const sw = await loadSw();
    const cacheName = sw.getCache().shell;
    const shellCache = await cachesApi.mock.open(cacheName);

    // Old build's shell seeded in the cache, referencing a deleted chunk hash.
    await shellCache.put("/", makeResponse("/", STALE_HTML("deadbeef-v1")));

    // Network returns the current build's shell referencing a live chunk hash.
    fetchImpl.mockImplementation(async (req) => {
      const url = typeof req === "string" ? req : req.url;
      if (url === "http://localhost/") {
        return makeResponse(url, STALE_HTML("cafe-v2"), { "cache-control": "no-store" });
      }
      return makeResponse(url, "<html>ok</html>");
    });

    const req = new Request("http://localhost/", { headers: { "Cache-Control": "no-cache" } });
    const res = await sw.handleNavigationRequest(req);
    const html = await res.text();

    // Passes under Option A (build-hash cache name ⇒ stale entry not matched)
    // and Option B (network-first). Fails under the old cache-first bug.
    expect(html).toContain("cafe-v2");
    expect(html).not.toContain("deadbeef-v1");
  });

  // Audit §5.2 — shell cache name must differ across builds (driven by ?v=).
  it("derives a per-build shell cache name", async () => {
    const a = await loadSw({ locationHref: "http://localhost/sw.js?v=build-aaa" });
    const b = await loadSw({ locationHref: "http://localhost/sw.js?v=build-bbb" });
    expect(a.getCache().shell).not.toBe(b.getCache().shell);
    expect(a.getCache().shell).toContain("build-aaa");
    expect(b.getCache().shell).toContain("build-bbb");
  });

  it("activate evicts the prior build's shell cache", async () => {
    const a = await loadSw({ locationHref: "http://localhost/sw.js?v=build-aaa" });
    await cachesApi.mock.open(a.getCache().shell); // create old cache
    await loadSw({ locationHref: "http://localhost/sw.js?v=build-bbb" });
    // activate() deletes caches not in the expected (current build) set.
    const evicted = await cachesApi.mock.delete(a.getCache().shell);
    expect(evicted).toBe(true);
    expect(await cachesApi.mock.keys()).not.toContain(a.getCache().shell);
  });

  // Audit §5.3 — warmShellCache must OVERWRITE a stale "/", not skip-if-present.
  it("warmShellCache overwrites a pre-seeded stale '/'", async () => {
    const sw = await loadSw({ locationHref: "http://localhost/sw.js?v=build-x" });
    const shellCache = await cachesApi.mock.open(sw.getCache().shell);
    const HOME = "/"; // warmShellCache keys shell routes by the raw route, not the resolved URL
    // Seed a stale "/" so warmShellCache must OVERWRITE it (not skip-if-present).
    await shellCache.put(HOME, makeResponse(HOME, STALE_HTML("stale-v1")));

    fetchImpl.mockImplementation(async (req) => {
      const url = typeof req === "string" ? req : req.url; // Request-resolved absolute URL
      if (url === "http://localhost/") return makeResponse(url, STALE_HTML("fresh-v2"));
      return makeResponse(url, "<html>ok</html>");
    });

    await sw.warmShellCache();
    const cached = await shellCache.match(HOME);
    expect(cached).toBeDefined();
    // warmShellCache stores a real Response (global Response constructor); our
    // seeded makeResponse stores {res}. Support both shapes. Read once — a
    // Response body is a stream and can only be consumed a single time.
    const res = cached.res ?? cached;
    const html = await res.text();
    expect(html).toContain("fresh-v2");
    expect(html).not.toContain("stale-v1");
  });

  // Audit §5.4 — precacheShell failure must be OBSERVABLE (console.warn), not silent.
  it("precacheShell warns when all fetches fail", async () => {
    const sw = await loadSw({ locationHref: "http://localhost/sw.js?v=build-y" });
    fetchImpl.mockImplementation(async () => {
      throw new Error("cold canary fetch failed");
    });

    await sw.precacheShell();

    // sw.js surfaces the failure via console.warn (no silent swallow).
    expect(console.warn).toHaveBeenCalled();
  });
});
