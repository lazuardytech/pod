import { NextResponse } from "next/server";
import { validateFetchUrl } from "@/lib/validateUrl";

export const dynamic = "force-dynamic";

const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter((m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0" && m.context_length >= 200000)
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) => models.filter((m) => m.id?.endsWith("-free")).map((m) => ({ id: m.id, name: m.id })),
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  // Validate the URL — must be http/https and not a private address
  const urlCheck = validateFetchUrl(url);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
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
