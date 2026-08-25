/**
 * Shared test harness for API route contract tests.
 *
 * Provides:
 * - Temp SQLite DB fixture (creates temp DATA_DIR, seeds DB, cleans up)
 * - Request factory helpers (makeRequest, makeJsonRequest)
 * - Auth helper (createApiKeyAuth, setRequireApiKey)
 * - Response parsing utilities (readJson, expectCors)
 *
 * Usage:
 *   import { setupHarness, teardownHarness, makeRequest, makeJsonRequest, createApiKeyAuth } from "@/tests/helpers/apiRouteHarness";
 *
 *   beforeEach(async () => { await setupHarness(importDbPayload); });
 *   afterEach(async () => { await teardownHarness(); });
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";

let tempDir;
let originalDataDir;

/**
 * Set up a temp DATA_DIR with optional DB seed.
 * @param {object} [seedData] - Optional DB payload to seed via importDb
 *   { providerConnections?, providerNodes?, proxyPools?, combos?, apiKeys?, settings?, modelAliases?, customModels? }
 */
export async function setupHarness(seedData) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-test-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;

  // Initialize SQLite DB in the temp dir (import triggers schema creation)
  if (seedData) {
    const { importDb } = await import("@/lib/localDb");
    await importDb(seedData);
  } else {
    // Import empty payload to trigger schema creation
    const { importDb } = await import("@/lib/localDb");
    await importDb({});
  }
}

/**
 * Teardown temp DATA_DIR and restore original env.
 */
export async function teardownHarness() {
  // Close SQLite connection
  try {
    const { getDatabase } = await import("@/lib/sqlite/connection");
    const db = getDatabase();
    if (db && typeof db.close === "function") db.close();
  } catch {
    // ignore
  }

  process.env.DATA_DIR = originalDataDir;
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
}

/**
 * Create an API key in the DB and return auth header value.
 * @param {string} name - Friendly name for the key
 * @param {string} [machineId] - Machine ID (auto-generated if omitted)
 * @param {object} [limits] - Optional rate limits { requestsPerMinute?, concurrentRequests? }
 * @returns {{ apiKey: string, authHeader: string }}
 */
export async function createApiKeyAuth(name, machineId, limits = {}) {
  const { createApiKey } = await import("@/lib/localDb");
  const key = await createApiKey({
    name: name || "test-key",
    machineId: machineId || "test-machine",
    apiKey: `sk-test-${Date.now()}`,
    enabled: true,
    ...limits,
  });
  return {
    apiKey: key.apiKey || key.key,
    authHeader: `Bearer ${key.apiKey || key.key}`,
  };
}

/**
 * Set requireApiKey setting.
 * @param {boolean} enabled
 */
export async function setRequireApiKey(enabled) {
  const { updateSettings } = await import("@/lib/localDb");
  await updateSettings({ requireApiKey: enabled });
}

/** Dashboard APIs 401 when requireLogin defaults true; tests that skip cookies must opt out. */
export async function disableDashboardLogin() {
  const { updateSettings } = await import("@/lib/localDb");
  await updateSettings({ requireLogin: false });
}

/**
 * Make a request to a Next.js route handler.
 * @param {string} path - URL path (e.g. "/v1/chat/completions")
 * @param {object} [opts] - Request options
 * @param {string} [opts.method] - HTTP method (default "GET")
 * @param {object} [opts.headers] - Extra headers
 * @param {string} [opts.body] - Raw body string
 * @returns {Promise<Response>}
 */
export function makeRequest(path, opts = {}) {
  const url = `http://localhost${path}`;
  const headers = { ...opts.headers };
  return new Request(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body || null,
  });
}

/**
 * Make a JSON request to a Next.js route handler.
 * @param {string} path - URL path
 * @param {object} body - JSON body
 * @param {object} [opts] - Extra request options
 * @returns {Promise<Response>}
 */
export function makeJsonRequest(path, body, opts = {}) {
  const req = makeRequest(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body: JSON.stringify(body),
    ...opts,
  });
  return req;
}

/**
 * Parse response JSON.
 * @param {Response} res
 * @returns {Promise<object>}
 */
export async function readJson(res) {
  return res.json();
}

/**
 * Assert CORS headers on a response.
 * @param {Response} res
 */
export function expectCors(res) {
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
}
