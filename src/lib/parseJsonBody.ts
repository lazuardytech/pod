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

export type ReadBodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: "aborted" }
  | { ok: false; reason: "too_large"; maxBytes: number };

export async function readBodyText(
  request: Request,
  options: { maxBytes: number },
): Promise<ReadBodyResult> {
  let text: string;
  try {
    text = await request.text();
  } catch (err) {
    const name = (err as { name?: unknown })?.name;
    const message = (err as { message?: unknown })?.message;
    if (
      name === "AbortError" ||
      (typeof message === "string" && message.toLowerCase().includes("aborted"))
    ) {
      return { ok: false, reason: "aborted" };
    }
    throw err;
  }
  if (text.length > options.maxBytes) {
    return { ok: false, reason: "too_large", maxBytes: options.maxBytes };
  }
  return { ok: true, text };
}
