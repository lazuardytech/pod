import { NextResponse } from "next/server";
import { fetchUrlError } from "@/app/api/_types";
import { validateFetchUrl } from "@/lib/validateUrl";

export const dynamic = "force-dynamic";

type SuggestedModel = Record<string, unknown> & {
  id?: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
};

const FILTERS = {
  "openrouter-free": (models: SuggestedModel[]) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          Number(m.context_length ?? 0) >= 200000,
      )
      .map((m) => ({
        id: m.id,
        name: m.name,
        contextLength: Number(m.context_length ?? 0),
      }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models: SuggestedModel[]) =>
    models
      .filter((m) => String(m.id ?? "").endsWith("-free"))
      .map((m) => ({ id: m.id, name: m.id })),
};

export async function GET(request: Request) {
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

  // Use the validated URL object so CodeQL can trace the SSRF guard
  const validatedUrl = urlCheck.url.href;

  try {
    const res = await fetch(validatedUrl);
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
