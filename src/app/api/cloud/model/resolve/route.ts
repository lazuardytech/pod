import { asString } from "@/app/api/_types";
import { NextResponse } from "next/server";
import { getModelAliases, validateApiKey } from "@/models";
import { parseJsonBody } from "@/lib/parseJsonBody";

// Resolve model alias to provider/model
export async function POST(request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing API key" }, { status: 401 });
    }

    const apiKey = authHeader.slice(7);

    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const alias = asString(body.alias);

    if (!alias) {
      return NextResponse.json({ error: "Missing alias" }, { status: 400 });
    }

    // Validate API key
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    // Get model aliases
    const modelAliases = await getModelAliases();
    const resolved = modelAliases[alias];

    if (resolved) {
      // Parse provider/model
      const firstSlash = resolved.indexOf("/");
      if (firstSlash > 0) {
        return NextResponse.json({
          alias,
          provider: resolved.slice(0, firstSlash),
          model: resolved.slice(firstSlash + 1),
        });
      }
    }

    // Not found
    return NextResponse.json({ error: "Alias not found" }, { status: 404 });
  } catch (error) {
    console.log("Model resolve error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
