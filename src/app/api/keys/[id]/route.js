import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

import { sanitizeError } from "@/lib/sanitizeError";
import { parseJsonBody } from "@/lib/parseJsonBody";
// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const [body, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const { isActive, name, limitType, requestsPerMinute, concurrentRequests } = body || {};

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (name !== undefined) updateData.name = name;
    if (limitType !== undefined) {
      if (!["unlimited", "limited"].includes(limitType)) {
        return NextResponse.json({ error: "limitType must be 'unlimited' or 'limited'" }, { status: 400 });
      }
      updateData.limitType = limitType;
    }
    if (requestsPerMinute !== undefined) updateData.requestsPerMinute = requestsPerMinute;
    if (concurrentRequests !== undefined) updateData.concurrentRequests = concurrentRequests;

    if ((limitType || existing.limitType) === "limited") {
      const rpm =
        updateData.requestsPerMinute !== undefined ? Number(updateData.requestsPerMinute) : existing.requestsPerMinute;
      const concurrent =
        updateData.concurrentRequests !== undefined
          ? Number(updateData.concurrentRequests)
          : existing.concurrentRequests;
      if (!Number.isFinite(rpm) || !Number.isInteger(rpm) || rpm <= 0) {
        return NextResponse.json({ error: "Request per Minute must be a positive integer" }, { status: 400 });
      }
      if (!Number.isFinite(concurrent) || !Number.isInteger(concurrent) || concurrent <= 0) {
        return NextResponse.json({ error: "Concurrent Request must be a positive integer" }, { status: 400 });
      }
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    if (String(error?.message || "").includes("positive integer")) {
      return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
