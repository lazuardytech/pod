/**
 * API Key utilities for Worker
 * Supports both formats:
 * - New: sk-{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 *
 * Call initApiKeySecret(secret) from the Worker entry point to inject the
 * secret from the env binding. Falls back to hardcoded default if not set.
 *
 * In production, set via Cloudflare Worker secret binding:
 *   wrangler secret put API_KEY_SECRET
 */

let _apiKeySecret = "endpoint-proxy-api-key-secret";

export function initApiKeySecret(secret: string): void {
  if (secret && typeof secret === "string" && secret.length > 0) {
    _apiKeySecret = secret;
  }
}

function getApiKeySecret(): string {
  return _apiKeySecret;
}

/**
 * Generate CRC (8-char HMAC) using Web Crypto API
 */
async function generateCrc(machineId: string, keyId: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(getApiKeySecret());
  const data = encoder.encode(machineId + keyId);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  return hashHex.slice(0, 8);
}

export interface ParsedApiKey {
  machineId: string | null;
  keyId: string;
  isNewFormat: boolean;
}

/**
 * Parse API key and extract machineId + keyId
 */
export async function parseApiKey(apiKey: string): Promise<ParsedApiKey | null> {
  if (!apiKey || !apiKey.startsWith("sk-")) return null;

  const parts = apiKey.split("-");

  // New format: sk-{machineId}-{keyId}-{crc8} = 4 parts
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;

    // Verify CRC
    const expectedCrc = await generateCrc(machineId!, keyId!);
    if (crc !== expectedCrc) return null;

    return { machineId: machineId!, keyId: keyId!, isNewFormat: true };
  }

  // Old format: sk-{random8} = 2 parts
  if (parts.length === 2) {
    return { machineId: null, keyId: parts[1]!, isNewFormat: false };
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}
