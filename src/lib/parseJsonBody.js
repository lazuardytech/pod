// Safe JSON body parser for API route handlers.
// Use instead of raw `request.json()` to prevent unhandled 500 on malformed JSON.

import { NextResponse } from "next/server";

export async function parseJsonBody(request) {
  try {
    const body = await request.json();
    return [body, null];
  } catch (_e) {
    return [null, NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })];
  }
}
