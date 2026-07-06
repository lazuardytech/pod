import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { createApiKey, getApiKeys } from "@/lib/localDb";
import { parseJsonBody } from "@/lib/parseJsonBody";

import { sanitizeError } from "@/lib/sanitizeError";
import { getConsistentMachineId } from "@/shared/utils/machineId";
export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { name, limitType, requestsPerMinute, concurrentRequests } = body || {};

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (limitType && !["unlimited", "limited"].includes(asString(limitType))) {
      return NextResponse.json(
        { error: "limitType must be 'unlimited' or 'limited'" },
        { status: 400 },
      );
    }

    if (limitType === "limited") {
      const rpm = Number(requestsPerMinute);
      const concurrent = Number(concurrentRequests);
      if (!Number.isFinite(rpm) || !Number.isInteger(rpm) || rpm <= 0) {
        return NextResponse.json(
          { error: "Request per Minute must be a positive integer" },
          { status: 400 },
        );
      }
      if (!Number.isFinite(concurrent) || !Number.isInteger(concurrent) || concurrent <= 0) {
        return NextResponse.json(
          { error: "Concurrent Request must be a positive integer" },
          { status: 400 },
        );
      }
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(asString(name), machineId, {
      limitType: limitType || "unlimited",
      requestsPerMinute,
      concurrentRequests,
    });

    return NextResponse.json(
      {
        key: apiKey.key,
        name: (apiKey as unknown as Record<string, unknown>).name,
        id: apiKey.id,
        machineId: apiKey.machineId,
        limitType: apiKey.limitType,
        requestsPerMinute: apiKey.requestsPerMinute,
        concurrentRequests: apiKey.concurrentRequests,
      },
      { status: 201 },
    );
  } catch (error) {
    console.log("Error creating key:", error);
    if (String((error as Error)?.message || "").includes("positive integer")) {
      return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
