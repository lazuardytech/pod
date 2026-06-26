import { NextResponse } from "next/server";
import { testSingleConnection } from "./testUtils";

// POST /api/providers/[id]/test - Test connection
export async function POST(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const result = (await testSingleConnection(id)) as Record<string, unknown>;

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
