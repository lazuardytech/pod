import crypto from "node:crypto";
import { DEFAULT_API_KEY_SECRET, resolveApiKeySecret } from "@/lib/security/runtimeSecrets.mts";

function getApiKeySecret(): string {
  const secret = resolveApiKeySecret();
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[SECURITY] API_KEY_SECRET is missing. Set a strong random value instead of relying on the old default "${DEFAULT_API_KEY_SECRET}".`,
    );
  }

  return DEFAULT_API_KEY_SECRET;
}

/**
 * Generate 6-char random keyId using cryptographically secure randomness.
 * Note: this is NOT a password hash — it is a short identifier component
 * embedded in an API key whose integrity is protected by the HMAC-SHA256 CRC.
 */
function generateKeyId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i]! % chars.length];
  }
  return result;
}

/**
 * Generate CRC (8-char HMAC-SHA256 integrity check).
 * This is NOT a password hash — it is a tamper-detection checksum
 * embedded in an API key token. The input (machineId + keyId) is
 * not a password and carries no secret user credential; the HMAC
 * is used solely to verify the key was issued by this server.
 */
function generateCrc(machineId: string, keyId: string): string {
  const hmac = crypto.createHmac("sha256", getApiKeySecret());
  hmac.update(machineId + keyId);
  return hmac.digest("hex").slice(0, 8);
}

export type GeneratedApiKey = { key: string; keyId: string };

/**
 * Generate API key with machineId embedded
 * Format: sk-{machineId}-{keyId}-{crc8}
 * @param machineId - 16-char machine ID
 */
export function generateApiKeyWithMachine(machineId: string): GeneratedApiKey {
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  const key = `sk-${machineId}-${keyId}-${crc}`;
  return { key, keyId };
}

export type ParsedApiKey = { machineId: string; keyId: string; isNewFormat: boolean };

/**
 * Parse API key and extract machineId + keyId
 * Supports both formats:
 * - New: sk-{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 */
export function parseApiKey(apiKey: string): ParsedApiKey | null {
  if (!apiKey || !apiKey.startsWith("sk-")) return null;

  const parts = apiKey.split("-");

  // New format: sk-{machineId}-{keyId}-{crc8} = 4 parts
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;

    // Validate CRC
    const expectedCrc = generateCrc(machineId!, keyId!);
    if (crc !== expectedCrc) return null;

    return { machineId: machineId!, keyId: keyId!, isNewFormat: true };
  }

  // Old format: sk-{random8} = 2 parts
  if (parts.length === 2) {
    return { machineId: "", keyId: parts[1]!, isNewFormat: false };
  }

  return null;
}

/**
 * Verify API key CRC (only for new format)
 */
export function verifyApiKeyCrc(apiKey: string): boolean {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return false;

  // Old format doesn't have CRC, always valid if parsed
  if (!parsed.isNewFormat) return true;

  // New format already verified in parseApiKey
  return true;
}

/**
 * Check if API key is new format (contains machineId)
 */
export function isNewFormatKey(apiKey: string): boolean {
  const parsed = parseApiKey(apiKey);
  return parsed?.isNewFormat === true;
}
