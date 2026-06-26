import { NextResponse } from "next/server";
import { asApiRecord } from "@/app/api/_types";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";
import {
  deleteProviderConnection,
  getProviderConnectionById,
  getProxyPoolById,
  updateProviderConnection,
} from "@/models";

function normalizeProxyConfig(body: Record<string, unknown> = {}) {
  const hasAnyProxyField =
    Object.hasOwn(body, "connectionProxyEnabled") ||
    Object.hasOwn(body, "connectionProxyUrl") ||
    Object.hasOwn(body, "connectionNoProxy");

  if (!hasAnyProxyField) return { hasAnyProxyField: false };

  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return {
      hasAnyProxyField: true,
      error: "Connection proxy URL is required when connection proxy is enabled",
    };
  }

  return {
    hasAnyProxyField: true,
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolUpdate(proxyPoolIdInput: any) {
  if (proxyPoolIdInput === undefined) {
    return { hasProxyPoolField: false, proxyPoolId: null };
  }

  if (proxyPoolIdInput === null || proxyPoolIdInput === "" || proxyPoolIdInput === "__none__") {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPoolId = String(proxyPoolIdInput).trim();
  if (!proxyPoolId) {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(proxyPoolId);
  if (!proxyPool) {
    return { hasProxyPoolField: true, error: "Proxy pool not found" };
  }

  return { hasProxyPoolField: true, proxyPoolId };
}

function shouldMergeProviderSpecificData(existing: any, incoming: any, hasLegacyProxy: any, hasProxyPoolField: any) {
  return existing !== undefined || incoming !== undefined || hasLegacyProxy || hasProxyPoolField;
}

// GET /api/providers/[id] - Get single connection
export async function GET(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Hide sensitive fields
    const result = { ...connection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error fetching connection");
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const {
      name,
      priority,
      globalPriority,
      defaultModel,
      isActive,
      apiKey,
      testStatus,
      lastError,
      lastErrorAt,
      providerSpecificData,
    } = body ?? ({} as any);

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolUpdate(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;

    if (
      shouldMergeProviderSpecificData(
        existing.providerSpecificData,
        providerSpecificData,
        proxyConfig.hasAnyProxyField,
        proxyPoolResult.hasProxyPoolField,
      )
    ) {
      const psd = {
        ...asApiRecord(existing.providerSpecificData),
        ...asApiRecord(providerSpecificData),
      };

      if (proxyConfig.hasAnyProxyField) {
        psd.connectionProxyEnabled = proxyConfig.connectionProxyEnabled;
        psd.connectionProxyUrl = proxyConfig.connectionProxyUrl;
        psd.connectionNoProxy = proxyConfig.connectionNoProxy;
      }

      if (proxyPoolResult.hasProxyPoolField) {
        if (proxyPoolResult.proxyPoolId === null) {
          delete psd.proxyPoolId;
        } else {
          psd.proxyPoolId = proxyPoolResult.proxyPoolId;
        }
      }

      updateData.providerSpecificData = psd;
    }

    const updated = await updateProviderConnection(id, updateData);

    // Hide sensitive fields
    const result = { ...updated };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error updating connection");
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;

    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.log("Error deleting connection");
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
