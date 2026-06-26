import { fetchUrlError } from "@/app/api/_types";
import { NextResponse } from "next/server";
import { validateFetchUrl } from "@/lib/validateUrl";

export const dynamic = "force-dynamic";

const FILTERS = {
  "openrouter-free": (models: any) =>
    models
      .filter((m: any) => m.pricing?.prompt === "0" && m.pricing?.completion === "0" && m.context_length >= 200000)
      .map((m: any) => ({ id: m.id, name: (m as any).name, contextLength: m.context_length }))
      .sort((a: any, b: any) => b.contextLength - a.contextLength),

  "opencode-free": (models: any) => models.filter((m: any) => m.id?.endsWith("-free")).map((m: any) => ({ id: m.id, name: m.id })),
};

export async function GET(request: any) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type as keyof typeof FILTERS];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  // Validate the URL — must be http/https and not a private address
  const urlCheck = validateFetchUrl(url);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: fetchUrlError(urlCheck) }, { status: 400 });
  }

  try {
    // url is validated by validateFetchUrl above. lgtm[js/request-forgery]
    const res = await fetch(url); // lgtm[js/request-forgery]
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const data = filter(Array.isArray(raw) ? raw : []);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
