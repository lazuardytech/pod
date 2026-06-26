/**
 * URL validation utilities for SSRF prevention. Used by API routes that accept
 * user-supplied URLs and make server-side fetch calls.
 */

// Private/internal IP ranges that should not be reachable from server-side fetch
const PRIVATE_IP_PATTERNS = [
  /^0\./, // current host (0.0.0.0)
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 unique local
  /^fd[0-9a-f]{2}:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal", // GCP metadata alternative
]);

const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".localtest.me",
  ".lvh.me",
  ".nip.io",
  ".sslip.io",
];

/**
 * Check if a hostname resolves to a private/internal address.
 * This is a static check on the hostname string — it cannot catch all cases
 * (e.g. DNS rebinding), but blocks the most common SSRF vectors.
 */
function isPrivateHostname(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/\.+$/, "");
  if (PRIVATE_HOSTNAMES.has(h)) return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix))) return true;
  // Bare numeric IPv4
  if (PRIVATE_IP_PATTERNS.some((re) => re.test(h))) return true;
  // Bracketed IPv6 e.g. [::1]
  const ipv6 = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (PRIVATE_IP_PATTERNS.some((re) => re.test(ipv6))) return true;
  return false;
}

export type ValidateFetchUrlOptions = {
  allowPrivate?: boolean;
};

export type ValidateFetchUrlResult = { ok: true; url: URL } | { ok: false; error: string };

/**
 * Validate a user-supplied URL for use in server-side fetch calls. Blocks
 * non-http(s) protocols and private/internal IP ranges.
 */
export function validateFetchUrl(url: unknown, options: ValidateFetchUrlOptions = {}): ValidateFetchUrlResult {
  const { allowPrivate = false } = options;
  if (!url || typeof url !== "string") {
    return { ok: false, error: "URL is required" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are allowed" };
  }

  if (!allowPrivate && isPrivateHostname(parsed.hostname)) {
    return { ok: false, error: "Requests to private/internal addresses are not allowed" };
  }

  return { ok: true, url: parsed };
}
