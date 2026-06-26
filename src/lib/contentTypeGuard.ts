// Content-Type validation middleware for API route handlers.

import { NextResponse } from "next/server";

export function requireJsonContent(request: Request): NextResponse | null {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}
