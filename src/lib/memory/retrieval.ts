import { getDatabase } from "@/lib/sqlite/connection";

function estimateTokens(text: string | null | undefined): number {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type MemoryRow = {
  id: string;
  api_key_id?: string;
  session_id?: string | null;
  type?: string;
  key?: string;
  content?: string;
  metadata?: string | null;
  created_at?: string;
  updated_at?: string;
  expires_at?: string | null;
};

export type RetrievedMemory = {
  id: string;
  apiKeyId: string;
  sessionId: string;
  type: string;
  key: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
};

function rowToMemory(row: MemoryRow): RetrievedMemory {
  const createdAt = row.created_at || new Date().toISOString();
  const updatedAt = row.updated_at || createdAt;
  return {
    id: String(row.id),
    apiKeyId: String(row.api_key_id || ""),
    sessionId: String(row.session_id || ""),
    type: String(row.type || ""),
    key: String(row.key || ""),
    content: String(row.content || ""),
    metadata: parseMetadata(row.metadata),
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
  };
}

function keywordScore(memory: RetrievedMemory, query: string): number {
  const normalizedQuery = String(query || "")
    .trim()
    .toLowerCase();
  if (!normalizedQuery) return 0;
  const haystacks = [
    String(memory.content || "").toLowerCase(),
    String(memory.key || "").toLowerCase(),
    JSON.stringify(memory.metadata || {}).toLowerCase(),
  ];
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const haystack of haystacks) {
    if (haystack.includes(normalizedQuery)) score += 20;
    for (const token of tokens) {
      if (!token) continue;
      if (haystack === String(memory.key || "").toLowerCase() && haystack.includes(token)) {
        score += 6;
        continue;
      }
      const matches = haystack.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
      score += (matches?.length || 0) * 3;
    }
  }
  return score;
}

function hasTable(tableName: string): boolean {
  const db = getDatabase();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

export type RetrievalConfig = {
  enabled?: boolean;
  maxTokens?: number;
  retrievalStrategy?: "exact" | "semantic" | "hybrid" | "recent";
  retentionDays?: number;
  query?: string;
  scope?: "apiKey" | "session";
  sessionId?: string;
};

export async function retrieveMemories(
  apiKeyId: string,
  config: RetrievalConfig = {},
): Promise<RetrievedMemory[]> {
  if (!apiKeyId) return [];
  const enabled = config.enabled !== false;
  if (!enabled) return [];

  const db = getDatabase();
  const maxTokens = Math.min(Math.max(Number(config.maxTokens || 2000), 1), 8000);
  const resolvedStrategy =
    config.retrievalStrategy === "recent" ? "exact" : config.retrievalStrategy || "exact";
  const strategy = resolvedStrategy;
  const retentionDays = Number.isFinite(config.retentionDays)
    ? (config.retentionDays as number)
    : 30;
  const queryText = typeof config.query === "string" ? config.query.trim() : "";

  let baseQuery =
    "SELECT * FROM memories WHERE api_key_id = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))";
  const baseParams: unknown[] = [apiKeyId];
  if (config.scope === "session" && config.sessionId) {
    baseQuery += " AND session_id = ?";
    baseParams.push(config.sessionId);
  }
  if (retentionDays > 0) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    baseQuery += " AND datetime(created_at) >= datetime(?)";
    baseParams.push(cutoff);
  }

  let rows: MemoryRow[] = [];
  const ftsAvailable = hasTable("memory_fts");

  if ((strategy === "semantic" || strategy === "hybrid") && queryText && ftsAvailable) {
    try {
      rows = db
        .prepare(
          `SELECT m.* FROM memories m
           JOIN memory_fts f ON m.rowid = f.rowid
           WHERE f.memory_fts MATCH ?
             AND m.api_key_id = ?
             AND (m.expires_at IS NULL OR datetime(m.expires_at) > datetime('now'))
           ORDER BY m.created_at DESC
           LIMIT 100`,
        )
        .all(queryText, apiKeyId) as MemoryRow[];
    } catch {
      rows = [];
    }
  }

  if (rows.length === 0 || strategy === "exact" || strategy === "hybrid") {
    const keywordRows = db
      .prepare(`${baseQuery} ORDER BY created_at DESC LIMIT 100`)
      .all(...baseParams) as MemoryRow[];
    if (strategy === "hybrid" && rows.length > 0) {
      const seen = new Set(rows.map((r) => String(r.id)));
      for (const row of keywordRows) {
        const id = String(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push(row);
      }
    } else if (rows.length === 0) {
      rows = keywordRows;
    }
  }

  const ranked = rows
    .map((row) => {
      const memory = rowToMemory(row);
      const score = queryText ? keywordScore(memory, queryText) : 0;
      return { memory, score };
    })
    .filter((entry) => !queryText || entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.memory.createdAt.getTime() - a.memory.createdAt.getTime();
    });

  const selected: RetrievedMemory[] = [];
  let totalTokens = 0;
  for (const entry of ranked) {
    const tokens = estimateTokens(entry.memory.content);
    if (totalTokens + tokens > maxTokens) {
      if (selected.length === 0) {
        selected.push(entry.memory);
      }
      break;
    }
    selected.push(entry.memory);
    totalTokens += tokens;
  }
  return selected;
}
