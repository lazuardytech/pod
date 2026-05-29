import { NextResponse } from "next/server";
import { getProviderConnections, updateProviderConnection } from "@/models";
import { invalidateConnectionsCache } from "@/sse/services/auth";

const CONN_LOCK_UNTIL_KEY = "connectionLockUntil";
const CONN_LOCK_COUNT_KEY = "connectionLockCount";
const CONN_LOCK_REASON_KEY = "connectionLockReason";

// POST /api/provider-nodes/[id]/clear-connection-lock
// Clears the connection-level lock for a specific connection.
export async function POST(_request, { params }) {
  try {
    const { id } = await params;

    const connections = await getProviderConnections();
    const conn = connections.find((c) => c.id === id);
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await updateProviderConnection(id, {
      [CONN_LOCK_UNTIL_KEY]: null,
      [CONN_LOCK_COUNT_KEY]: null,
      [CONN_LOCK_REASON_KEY]: null,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
    });

    if (conn.provider) invalidateConnectionsCache(conn.provider);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] Failed to clear connection lock:", error);
    return NextResponse.json({ error: "Failed to clear connection lock" }, { status: 500 });
  }
}
