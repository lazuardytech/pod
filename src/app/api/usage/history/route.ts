import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { checkDashboardApiAuth } from "@/lib/routeAuth";

export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const stats = await getUsageStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
