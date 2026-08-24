import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";
import { getProviderNodeById, getProviderNodes, renameProviderNode } from "@/models";
import {
  AI_PROVIDERS,
  ANTHROPIC_COMPATIBLE_PREFIX,
  CUSTOM_EMBEDDING_PREFIX,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
  isOpenAICompatibleProvider,
  OPENAI_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { invalidateConnectionsCache } from "@/sse/services/auth";
import { checkDashboardApiAuth } from "@/lib/routeAuth";

export const dynamic = "force-dynamic";

const PREFIX_BY_TYPE = {
  "openai-compatible": OPENAI_COMPATIBLE_PREFIX,
  "anthropic-compatible": ANTHROPIC_COMPATIBLE_PREFIX,
  "custom-embedding": CUSTOM_EMBEDDING_PREFIX,
};

const ID_REGEX = /^[a-zA-Z0-9_.-]+$/;

function isCustomNode(node: { id?: string; type?: string; apiType?: string } | null | undefined) {
  if (!node) return false;
  return (
    isOpenAICompatibleProvider(node.id) ||
    isAnthropicCompatibleProvider(node.id) ||
    isCustomEmbeddingProvider(node.id)
  );
}

// PATCH /api/provider-nodes/[id]/rename - Rename a custom provider node's identifier
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const { id: oldId } = await params;
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const newId = typeof body?.newId === "string" ? body.newId.trim() : "";

    if (!newId) {
      return NextResponse.json({ error: "newId is required" }, { status: 400 });
    }
    if (newId === oldId) {
      return NextResponse.json(
        { error: "newId must differ from current identifier" },
        { status: 400 },
      );
    }
    if (!ID_REGEX.test(newId)) {
      return NextResponse.json(
        { error: "Identifier can only contain letters, numbers, -, _ and ." },
        { status: 400 },
      );
    }

    const current = await getProviderNodeById(oldId);
    if (!current) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    // Only allow renaming custom (compatible / embedding) nodes — built-in
    // provider ids are referenced by hardcoded handler routing and OAuth
    // flows.
    if (!isCustomNode(current)) {
      return NextResponse.json({ error: "Built-in providers cannot be renamed" }, { status: 400 });
    }

    // Preserve the type prefix so downstream `isOpenAICompatibleProvider()`
    // etc. continue to classify the node correctly.
    const requiredPrefix = PREFIX_BY_TYPE[current.type as keyof typeof PREFIX_BY_TYPE];
    if (requiredPrefix && !newId.startsWith(requiredPrefix)) {
      return NextResponse.json(
        { error: `Identifier must start with "${requiredPrefix}"` },
        { status: 400 },
      );
    }

    // Reject collisions with built-in providers as well as existing custom
    // nodes (the DB layer catches custom-node collisions, but checking here
    // returns a friendlier error before opening the transaction).
    if (AI_PROVIDERS[newId]) {
      return NextResponse.json(
        { error: "Identifier conflicts with a built-in provider" },
        { status: 400 },
      );
    }
    const nodes = await getProviderNodes();
    if (nodes.some((n) => n.id === newId)) {
      return NextResponse.json(
        { error: "Identifier already in use by another node" },
        { status: 400 },
      );
    }

    const updated = await renameProviderNode(oldId, newId);

    // In-memory caches in the auth/credentials hot path are keyed by
    // providerId — drop them so the next request rebuilds against the
    // renamed rows.
    invalidateConnectionsCache(oldId);
    invalidateConnectionsCache(newId);

    return NextResponse.json({ node: updated });
  } catch (error) {
    const message =
      typeof (error as Error)?.message === "string"
        ? sanitizeError(error)
        : "Failed to rename provider node";
    console.log("Error renaming provider node:", message);
    const status = /not found/i.test(message)
      ? 404
      : /already in use|conflict|must differ|required/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
