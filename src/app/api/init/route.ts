// Auto-initialize cloud sync when server starts
import "@/lib/initCloudSync";
import { checkDashboardApiAuth } from "@/lib/routeAuth";

// This API route is called automatically to initialize sync
export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  return new Response("Initialized", { status: 200 });
}
