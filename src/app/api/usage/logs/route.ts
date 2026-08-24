import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { checkDashboardApiAuth } from "@/lib/routeAuth";

export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
