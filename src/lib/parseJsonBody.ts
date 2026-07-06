/**
 * Safely parse a request body as JSON. Returns the parsed body and a `null` error
 * on success, or a `NextResponse` with a 400 status on failure. Use this in API
 * route handlers instead of raw `request.json()` to avoid unhandled 500s on
 * malformed JSON.
 */
import { NextResponse } from "next/server";

export type ParseJsonBodyResult = readonly [unknown, null] | readonly [null, NextResponse];

export async function parseJsonBody(request: Request): Promise<ParseJsonBodyResult> {
  try {
    const body = (await request.json()) as unknown;
    return [body, null];
  } catch {
    return [null, NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })];
  }
}
