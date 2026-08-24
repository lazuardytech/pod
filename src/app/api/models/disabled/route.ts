import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { disableModels, enableModels, getDisabledModels } from "@/lib/disabledModelsDb";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { checkDashboardApiAuth } from "@/lib/routeAuth";

export const dynamic = "force-dynamic";

// GET /api/models/disabled?providerAlias=xxx
export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const all = await getDisabledModels();
    if (providerAlias) return NextResponse.json({ ids: all[providerAlias] || [] });
    return NextResponse.json({ disabled: all });
  } catch (error) {
    console.log("Error fetching disabled models:", error);
    return NextResponse.json({ error: "Failed to fetch disabled models" }, { status: 500 });
  }
}

// POST /api/models/disabled  body: { providerAlias, ids: [...] }
export async function POST(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { providerAlias, ids } = body ?? ({} as Record<string, unknown>);
    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }
    await disableModels(asString(providerAlias), ids as string[]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error disabling models:", error);
    return NextResponse.json({ error: "Failed to disable models" }, { status: 500 });
  }
}

// DELETE /api/models/disabled?providerAlias=xxx[&id=yyy]
export async function DELETE(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    await enableModels(providerAlias, id ? [id] : []);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error enabling models:", error);
    return NextResponse.json({ error: "Failed to enable models" }, { status: 500 });
  }
}
