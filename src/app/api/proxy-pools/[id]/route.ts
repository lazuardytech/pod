import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { parseJsonBody } from "@/lib/parseJsonBody";
import {
  deleteProxyPool,
  getProviderConnections,
  getProxyPoolById,
  updateProxyPool,
} from "@/models";

function sanitizeProxyPool(pool: Record<string, unknown> | null | undefined) {
  if (!pool) return pool;
  const sanitized = { ...pool };
  delete sanitized.relayAuthToken;
  return sanitized;
}

function normalizeProxyPoolUpdate(body: Record<string, unknown> = {}) {
  const updates: Record<string, unknown> = {};

  if (Object.hasOwn(body, "name")) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return { error: "Name is required" };
    }
    updates.name = name;
  }

  if (Object.hasOwn(body, "proxyUrl")) {
    const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
    if (!proxyUrl) {
      return { error: "Proxy URL is required" };
    }
    updates.proxyUrl = proxyUrl;
  }

  if (Object.hasOwn(body, "noProxy")) {
    updates.noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  }

  if (Object.hasOwn(body, "isActive")) {
    updates.isActive = body?.isActive === true;
  }

  if (Object.hasOwn(body, "strictProxy")) {
    updates.strictProxy = body?.strictProxy === true;
  }

  if (Object.hasOwn(body, "type")) {
    const validTypes = ["http", "vercel"];
    updates.type = validTypes.includes(asString(body?.type)) ? asString(body.type) : "http";
  }

  return { updates };
}

function countBoundConnections(connections: unknown[] = [], proxyPoolId: unknown) {
  return connections.filter((connection) => {
    const psd = (connection as { providerSpecificData?: { proxyPoolId?: unknown } } | null)
      ?.providerSpecificData;
    return psd?.proxyPoolId === proxyPoolId;
  }).length;
}

// GET /api/proxy-pools/[id] - Get proxy pool
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    return NextResponse.json({
      proxyPool: sanitizeProxyPool(proxyPool as Record<string, unknown>),
    });
  } catch (error) {
    console.log("Error fetching proxy pool:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pool" }, { status: 500 });
  }
}

// PUT /api/proxy-pools/[id] - Update proxy pool
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const normalized = normalizeProxyPoolUpdate(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const updated = await updateProxyPool(id, normalized.updates ?? {});
    return NextResponse.json({ proxyPool: sanitizeProxyPool(updated as Record<string, unknown>) });
  } catch (error) {
    console.log("Error updating proxy pool:", error);
    return NextResponse.json({ error: "Failed to update proxy pool" }, { status: 500 });
  }
}

// DELETE /api/proxy-pools/[id] - Delete proxy pool
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const connections = await getProviderConnections();
    const boundConnectionCount = countBoundConnections(connections, id);

    if (boundConnectionCount > 0) {
      return NextResponse.json(
        {
          error: "Proxy pool is currently in use",
          boundConnectionCount,
        },
        { status: 409 },
      );
    }

    await deleteProxyPool(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting proxy pool:", error);
    return NextResponse.json({ error: "Failed to delete proxy pool" }, { status: 500 });
  }
}
