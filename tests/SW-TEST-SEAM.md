# SW / PWA Test Seam — what must exist before the tests run

QA wrote the SW coverage the audit (artifact `sw-shell-stale-cache-audit` §5) called for.
The **tests are written but NOT yet runnable** — the offline-first surface had zero
coverage and the supporting seams were missing. Ownership: SW Engineer supplies the
code seam; QA supplies the tests.

## Files added (QA)

- `tests/unit/swShellCache.test.js` — 4 unit tests (audit §5.1–§5.4).
- `tests/e2e/swDeployRegression.e2e.spec.ts` — deploy-regression e2e scaffold (§5.5).
- `tests/SW-TEST-SEAM.md` — this file.

## 1. Expose sw.js handlers (SW Engineer, BLOCKER for unit tests)

`public/sw.js` is a plain SW script with no exports. The tests import it as a module
and call the handlers directly. Add exports + a test-mode guard so importing the file
in node does NOT register `self` listeners:

```js
// at the bottom of public/sw.js
export {
  SHELL_CACHE_NAME, STATIC_CACHE_NAME, IMAGE_CACHE_NAME,
  handleNavigationRequest, handleStaticAssetRequest, handleImageRequest,
  precacheShell, warmShellCache,
};

// Register listeners ONLY in a real SW context. `self.registration` is undefined
// in the vitest node env, so importing for tests is side-effect free.
if (typeof self !== "undefined" && self.registration) {
  self.addEventListener("install", ...);
  self.addEventListener("activate", ...);
  self.addEventListener("fetch", ...);
}
```

## 2. Per-build cache name (SW Engineer, fixes §5.2 + §3 factor #1)

`SW_VERSION` today = `?v=` (release semver) only, so same-version deploys collide.
Inject a build/deploy hash so each deploy isolates + evicts the prior shell:

```js
// public/sw.js
const SW_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const BUILD_ID = (typeof process !== "undefined" && process.env.BUILD_ID) || SW_VERSION;
const SHELL_CACHE_NAME = `pod-shell-cache-${SW_VERSION}-${BUILD_ID}`;
```

(Wire `BUILD_ID` into the build via next.config `env` or a prebuild step; the SW is
served from `public/`, so the hash must be templated into `sw.js` at build time.)

## 3. warmShellCache overwrite-stale (SW Engineer, fixes §5.3 / §3 factor #3)

Change `if (existing.has(route)) return;` in `warmShellCache` to OVERWRITE when the
cached entry differs from the current build (e.g. always re-fetch when
`self.location` build id != cached `sw-build-id` header you store on put).

## 4. precacheShell observable failure (SW Engineer, fixes §5.4 / §3 factor #4)

Replace the silent swallow with a measurable signal:

```js
// inside precacheShell, after the precache Promise.all
if (cachedCount === 0) {
  self.dispatchEvent(new Ext... ) // or: self.dispatchEvent(new Event("pod:sw:precache-failed"))
}
```

The unit test `precacheShell emits an observable failure signal...` asserts
`self.dispatchEvent` was called with type `pod:sw:precache-failed`.

## 5. E2E setup (DevOps / QA)

```bash
bun add -D @playwright/test
bun x playwright install --with-deps
```

Add a `playwright.config.ts` pointing `webServer` at a two-build harness
(`buildAndServe` in `tests/e2e/swDeployRegression.e2e.spec.ts` is a TODO the harness
must fill: build v1 and v2 at the same `displayVersion`, different `BUILD_ID`, serve
both on one origin so the SW cache-name collision reproduces audit §2).

## Run commands (QA)

```bash
# Unit — after seam §1–§4 landed
bun x vitest run tests/unit/swShellCache.test.js --reporter=verbose

# E2E — after §5 harness wired
bun x playwright test tests/e2e/swDeployRegression.e2e.spec.ts
```
