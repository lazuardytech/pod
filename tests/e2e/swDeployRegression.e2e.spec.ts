/**
 * E2E — SW deploy-regression (audit §5.5, the direct proof).
 *
 * SCAFFOLD — not runnable until Playwright is installed and a two-build
 * harness exists (see tests/SW-TEST-SEAM.md §"E2E setup"). Documents the exact
 * assertions that prove "normal revisit after a deploy never serves a broken
 * shell (zero net::ERR_FAILED, all /_next/static 200, HTML references live hashes)".
 *
 * Run:
 *   bun x playwright test tests/e2e/swDeployRegression.e2e.spec.ts
 */

import { test, expect } from "@playwright/test";

/**
 * Two builds must be produced at the SAME displayVersion but DIFFERENT build
 * hashes, then served on the same origin so the SW cache name collides
 * (reproducing audit §2). Replace the helper bodies with your CI build step.
 */
async function buildAndServe(version /* "v1" | "v2" */) {
  // TODO(SW-ENG): `next build` with a unique BUILD_ID per version, then serve
  // `.next/standalone` (or `next start`) on a fixed port. Return { baseURL, chunkHashes }.
  throw new Error(`buildAndServe(${version}) — wire up your two-build harness`);
}

test.describe("SW stale-shell deploy regression", () => {
  test("revisit after deploy without hard-reload serves a working shell", async ({ page }) => {
    const v1 = await buildAndServe("v1");
    const v2 = await buildAndServe("v2");

    // 1. Boot at v1, let the SW install + claim.
    await page.goto(v1.baseURL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);

    // 2. Capture v1 chunk hashes actually referenced by the served HTML.
    const v1Html = await page.content();
    const v1Hashes = [...v1Html.matchAll(/\/_next\/static\/([^/"]+)\//g)].map((m) => m[1]);

    // 3. Swap the server to v2 (new hashes) WITHOUT closing the page/tab.
    await page.goto(v2.baseURL, { waitUntil: "domcontentloaded" });
    // Wait for the SW update + controllerchange reload to settle.
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, {
      timeout: 30000,
    });
    await page.waitForLoadState("networkidle");

    // 4. Assert zero failed subresources (the ERR_FAILED symptom).
    const failed = [];
    page.on("requestfailed", (r) => failed.push(r.url()));
    await page.reload({ waitUntil: "networkidle" }); // normal reload, NOT hard-reload
    expect(failed.filter((u) => u.includes("/_next/static/"))).toEqual([]);

    // 5. All /_next/static assets returned 200.
    const responses = [];
    page.on("response", (r) => {
      if (r.url().includes("/_next/static/")) responses.push(r);
    });
    await page.reload({ waitUntil: "networkidle" });
    for (const r of responses) expect(r.status()).toBe(200);

    // 6. Served HTML references v2 hashes, not the deleted v1 hashes.
    const html = await page.content();
    const v2Hashes = [...html.matchAll(/\/_next\/static\/([^/"]+)\//g)].map((m) => m[1]);
    expect(v2Hashes.length).toBeGreaterThan(0);
    for (const h of v1Hashes) expect(v2Hashes).toContain(h); // staleness check
  });
});
