import { errorResponse } from "open-sse/utils/error.js";
import { extractBearerToken, parseApiKey } from "../utils/apiKey.js";
import { getMachineData } from "../services/storage.js";
import * as log from "../utils/logger.js";

export async function handleCacheClear(request, env) {
  const apiKey = extractBearerToken(request);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const body = await request.json().catch(() => ({}));

    // Get machineId from API key or body
    let machineId = body.machineId;
    if (!machineId) {
      const parsed = await parseApiKey(apiKey);
      machineId = parsed?.machineId;
    }

    if (!machineId) {
      return new Response(JSON.stringify({ error: "Missing machineId" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Validate that the API key exists for this machine
    const data = await getMachineData(machineId, env);
    const validKeys = Array.isArray(data?.apiKeys) ? data.apiKeys : [];
    const isValid = validKeys.some(k => typeof k === "string" && k === apiKey);
    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid API key for this machine" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    log.info("CACHE", `Cache clear requested for machine: ${machineId} (no-op)`);

    return new Response(JSON.stringify({ success: true, machineId, message: "No cache layer" }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    log.error("CACHE", error?.message || "Unknown error");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}