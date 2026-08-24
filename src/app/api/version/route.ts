import pkg from "../../../../package.json" with { type: "json" };
import { checkDashboardApiAuth } from "@/lib/routeAuth";

export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  return Response.json({ currentVersion: pkg.version });
}
