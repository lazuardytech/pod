import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { createProviderNode, getProviderNodes } from "@/models";
import {
  ANTHROPIC_COMPATIBLE_PREFIX,
  CUSTOM_EMBEDDING_PREFIX,
  OPENAI_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { generateId } from "@/shared/utils";

export const dynamic = "force-dynamic";

const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

const CUSTOM_EMBEDDING_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

// GET /api/provider-nodes - List all provider nodes
export async function GET() {
  try {
    const nodes = await getProviderNodes();
    return NextResponse.json({ nodes });
  } catch (error) {
    console.log("Error fetching provider nodes:", error);
    return NextResponse.json({ error: "Failed to fetch provider nodes" }, { status: 500 });
  }
}

// POST /api/provider-nodes - Create provider node
export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const name = asString(body.name);
    const prefix = asString(body.prefix);
    const apiType = asString(body.apiType);
    const baseUrl = asString(body.baseUrl);
    const type = asString(body.type);
    const identifier = asString(body.identifier);

    if (!name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }

    // Determine type
    const nodeType = type || "openai-compatible";

    if (nodeType === "openai-compatible") {
      if (!apiType || !["chat", "responses"].includes(apiType)) {
        return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
      }
      const customId = identifier.trim();
      if (customId && !customId.startsWith(OPENAI_COMPATIBLE_PREFIX)) {
        return NextResponse.json(
          { error: `Identifier must start with "${OPENAI_COMPATIBLE_PREFIX}"` },
          { status: 400 },
        );
      }
      const node = await createProviderNode({
        id: customId || `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${generateId()}`,
        type: "openai-compatible",
        prefix: prefix.trim(),
        apiType,
        baseUrl: (baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl).trim(),
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "custom-embedding") {
      const customId = identifier?.trim();
      if (customId && !customId.startsWith(CUSTOM_EMBEDDING_PREFIX)) {
        return NextResponse.json({ error: `Identifier must start with "${CUSTOM_EMBEDDING_PREFIX}"` }, { status: 400 });
      }
      let sanitizedBaseUrl = (baseUrl || CUSTOM_EMBEDDING_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }
      const node = await createProviderNode({
        id: customId || `${CUSTOM_EMBEDDING_PREFIX}${generateId()}`,
        type: "custom-embedding",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "anthropic-compatible") {
      const customId = identifier?.trim();
      if (customId && !customId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX)) {
        return NextResponse.json(
          { error: `Identifier must start with "${ANTHROPIC_COMPATIBLE_PREFIX}"` },
          { status: 400 },
        );
      }
      let sanitizedBaseUrl = (baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9);
      }
      const node = await createProviderNode({
        id: customId || `${ANTHROPIC_COMPATIBLE_PREFIX}${generateId()}`,
        type: "anthropic-compatible",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid provider node type" }, { status: 400 });
  } catch (error) {
    console.log("Error creating provider node:", error);
    return NextResponse.json({ error: "Failed to create provider node" }, { status: 500 });
  }
}
