import { NextResponse } from "next/server";
import { getProviderConnections, getSettings, updateProviderConnection } from "@/lib/localDb";
import { validateFetchUrl } from "@/lib/validateUrl";

const MODEL_LOCK_PREFIX = "modelLock_";

function getActiveModelLocks(connection) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]) => ({
      key,
      model: key.slice(MODEL_LOCK_PREFIX.length) || "__all",
      until: value,
      active: new Date(value).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const models = [];

    for (const connection of connections) {
      const locks = getActiveModelLocks(connection);
      for (const lock of locks) {
        models.push({
          provider: connection.provider,
          model: lock.model,
          status: "cooldown",
          until: lock.until,
          connectionId: connection.id,
          connectionName: connection.name || connection.email || connection.id,
          lastError: connection.lastError || null,
        });
      }

      if (locks.length === 0 && connection.testStatus === "unavailable") {
        models.push({
          provider: connection.provider,
          model: "__all",
          status: "unavailable",
          connectionId: connection.id,
          connectionName: connection.name || connection.email || connection.id,
          lastError: connection.lastError || null,
        });
      }
    }

    return NextResponse.json({
      models,
      unavailableCount: models.length,
    });
  } catch (error) {
    console.error("[API] Failed to get model availability:", error);
    return NextResponse.json({ error: "Failed to fetch model availability" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { action, provider, model } = await request.json();

    if (!provider || !model) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Simple unconditional clear (legacy)
    if (action === "clearCooldown") {
      const connections = await getProviderConnections({ provider });
      const lockKey = `${MODEL_LOCK_PREFIX}${model}`;
      await Promise.all(
        connections
          .filter((connection) => connection[lockKey])
          .map((connection) =>
            updateProviderConnection(connection.id, {
              [lockKey]: null,
              ...(connection.testStatus === "unavailable"
                ? { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 }
                : {}),
            }),
          ),
      );
      return NextResponse.json({ ok: true });
    }

    // Test first, then clear only if passing — re-lock with minimum lockout if still failing
    if (action === "recheckAndClear") {
      const envBase = process.env.BASE_URL;
      // Validate BASE_URL env var if set; fall back to localhost with port from request
      // Using localhost avoids Host-header SSRF (the request hostname is not trusted for fetch).
      const baseUrl = (() => {
        if (envBase) {
          const check = validateFetchUrl(envBase, { allowPrivate: true });
          if (check.ok) return envBase.replace(/\/$/, "");
        }
        // Derive port from request URL but use localhost to avoid Host header SSRF
        const u = new URL(request.url);
        const port = u.port || (u.protocol === "https:" ? "443" : "80");
        return `http://localhost:${port}`;
      })();

      // Get an active internal API key for auth
      let apiKey = null;
      try {
        const { getApiKeys } = await import("@/lib/localDb");
        const keys = await getApiKeys();
        apiKey = keys.find((k) => k.isActive !== false)?.key || null;
      } catch {}

      const headers = { "Content-Type": "application/json", "x-pod-no-cache": "true" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      // Test the model
      // baseUrl is derived from the request host (internal loopback) or BASE_URL env var,
      // both validated above with allowPrivate:true — not a user-supplied value.
      // lgtm[js/request-forgery]
      let testOk = false;
      try {
        const testModel = model === "__all" ? null : model;
        if (testModel) {
          const res = await fetch(`${baseUrl}/api/models/test`, {
            // lgtm[js/request-forgery]
            method: "POST",
            headers,
            body: JSON.stringify({ model: `${provider}/${testModel}` }),
            signal: AbortSignal.timeout(15000),
          });
          const data = await res.json().catch(() => ({}));
          testOk = !!data?.ok;
        }
      } catch {}

      const connections = await getProviderConnections({ provider });
      const lockKey = `${MODEL_LOCK_PREFIX}${model}`;
      const settings = await getSettings().catch(() => ({}));
      const minimumLockoutMinutes = Number(settings.minimumLockoutMinutes) || 0;

      if (testOk) {
        // Test passed — clear the lock
        await Promise.all(
          connections
            .filter((c) => c[lockKey])
            .map((c) =>
              updateProviderConnection(c.id, {
                [lockKey]: null,
                ...(c.testStatus === "unavailable"
                  ? { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 }
                  : {}),
              }),
            ),
        );
        return NextResponse.json({ ok: true, tested: true, passed: true });
      }

      // Test failed — re-apply minimum lockout if configured, otherwise keep existing lock.
      // Apply the same backoff multiplier as markAccountUnavailable: 1x, 2x, 3x per backoffLevel.
      if (minimumLockoutMinutes > 0) {
        const minimumLockoutMs = minimumLockoutMinutes * 60 * 1000;
        await Promise.all(
          connections
            .filter((c) => c[lockKey])
            .map((c) => {
              const backoffMultiplier = Math.max(1, c.backoffLevel || 1);
              const effectiveMs = minimumLockoutMs * backoffMultiplier;
              const lockUntil = new Date(Date.now() + effectiveMs).toISOString();
              return updateProviderConnection(c.id, { [lockKey]: lockUntil });
            }),
        );
      }
      return NextResponse.json({ ok: false, tested: true, passed: false });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    return NextResponse.json({ error: "Failed to clear cooldown" }, { status: 500 });
  }
}
