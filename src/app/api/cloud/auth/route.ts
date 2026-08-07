import { NextResponse } from "next/server";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { getModelAliases, getProviderConnections } from "@/models";

// Verify API key and return provider credentials
export async function POST(request: Request) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    // Get active provider connections
    const connections = await getProviderConnections({ isActive: true });

    // Map connections
    const mappedConnections = connections.map((conn) => ({
      provider: conn.provider,
      authType: conn.authType,
      apiKey: conn.apiKey || null,
      accessToken: conn.accessToken || null,
      refreshToken: conn.refreshToken || null,
      projectId: conn.projectId || null,
      expiresAt: conn.expiresAt,
      priority: conn.priority,
      globalPriority: conn.globalPriority,
      defaultModel: conn.defaultModel,
      isActive: conn.isActive,
    }));

    // Get model aliases
    const modelAliases = await getModelAliases();

    return NextResponse.json({
      connections: mappedConnections,
      modelAliases,
    });
  } catch (error) {
    console.log("Cloud auth error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
