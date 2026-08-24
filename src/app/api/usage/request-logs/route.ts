import { NextResponse } from "next/server";
import { getRecentLogsStructured } from "@/lib/usageDb";
import { checkDashboardApiAuth } from "@/lib/routeAuth";

export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "300"), 10000);
    const logs = await getRecentLogsStructured(limit);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("[API ERROR] /api/usage/request-logs failed:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
