import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/sqlite/connection";

type RequestLogRow = {
  id: string;
  timestamp: string;
  model?: string | null;
  provider?: string | null;
  account?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  status?: string | null;
  combo?: string | null;
  details_id?: string | null;
};

type RequestDetailsRow = Record<string, unknown> & {
  id?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  status?: string;
  latency_ms?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  data?: string;
};

/**
 * GET /api/usage/request-logs/[id]
 * Fetches the matching request_details row for a given request_log id.
 *
 * Matching strategy (in order):
 * 1. Direct lookup by details_id column (if present)
 * 2. Fuzzy match by model + timestamp within ±5min window
 * 3. Fuzzy match by timestamp only within ±5min window (no model filter)
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDatabase();

    const logRow = db.prepare("SELECT * FROM request_log WHERE id = ?").get<RequestLogRow>(id);
    if (!logRow) {
      return NextResponse.json({ error: "Log entry not found" }, { status: 404 });
    }

    let detail: RequestDetailsRow | null = null;

    try {
      // Strategy 1: direct details_id link (future-proof)
      if (logRow.details_id) {
        detail =
          db
            .prepare("SELECT * FROM request_details WHERE id = ?")
            .get<RequestDetailsRow>(logRow.details_id) ?? null;
      }

      // Strategy 2 & 3: fuzzy timestamp match
      if (!detail) {
        // Parse "DD-MM-YYYY HH:MM:SS" as local time
        const parts = String(logRow.timestamp).match(
          /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
        );
        if (parts) {
          const [, dd, mm, yyyy, hh, min, ss] = parts;
          // Build as local time string and let Date parse it
          const logDate = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`);

          // Use ±5 minute window to account for timezone offset differences
          const windowMs = 5 * 60 * 1000;
          const from = new Date(logDate.getTime() - windowMs).toISOString();
          const to = new Date(logDate.getTime() + windowMs).toISOString();

          // Strategy 2: match by model + timestamp
          const model = logRow.model && logRow.model !== "-" ? logRow.model : null;
          let candidates: RequestDetailsRow[] = [];

          if (model) {
            candidates = db
              .prepare(
                `SELECT * FROM request_details
                 WHERE model = ? AND timestamp >= ? AND timestamp <= ?
                 ORDER BY timestamp DESC
                 LIMIT 20`,
              )
              .all<RequestDetailsRow>(model, from, to);
          }

          // Strategy 3: fallback — match by timestamp only (no model filter)
          if (candidates.length === 0) {
            candidates = db
              .prepare(
                `SELECT * FROM request_details
                 WHERE timestamp >= ? AND timestamp <= ?
                 ORDER BY timestamp DESC
                 LIMIT 20`,
              )
              .all<RequestDetailsRow>(from, to);
          }

          if (candidates.length > 0) {
            // Pick closest by absolute time delta
            let best = candidates[0]!;
            let bestDelta = Math.abs(
              new Date(String(best.timestamp)).getTime() - logDate.getTime(),
            );
            for (const c of candidates.slice(1)) {
              const delta = Math.abs(new Date(String(c.timestamp)).getTime() - logDate.getTime());
              if (delta < bestDelta) {
                bestDelta = delta;
                best = c;
              }
            }
            detail = best;
          }
        }
      }
    } catch {
      // detail stays null — not fatal
    }

    let payload: Record<string, unknown> = {};
    if (detail) {
      try {
        payload = JSON.parse(String(detail.data || "{}"));
      } catch {}
    }

    return NextResponse.json({
      log: {
        id: logRow.id,
        timestamp: logRow.timestamp,
        model: logRow.model,
        provider: logRow.provider,
        account: logRow.account,
        promptTokens: logRow.prompt_tokens,
        completionTokens: logRow.completion_tokens,
        status: logRow.status,
        combo: logRow.combo,
      },
      detail: detail
        ? {
            id: detail.id,
            timestamp: detail.timestamp,
            provider: detail.provider,
            model: detail.model,
            status: detail.status,
            latency:
              payload.latency ??
              (detail.latency_ms !== null && detail.latency_ms !== undefined
                ? { total: detail.latency_ms }
                : {}),
            tokens: payload.tokens ?? {
              prompt_tokens: detail.prompt_tokens,
              completion_tokens: detail.completion_tokens,
            },
            request: payload.request ?? {},
            providerRequest: payload.providerRequest ?? {},
            providerResponse: payload.providerResponse ?? {},
            response: payload.response ?? {},
          }
        : null,
    });
  } catch (error) {
    console.error("[API ERROR] /api/usage/request-logs/[id] failed:", error);
    return NextResponse.json({ error: "Failed to fetch log detail" }, { status: 500 });
  }
}
