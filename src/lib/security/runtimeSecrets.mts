const TEST_API_KEY_SECRET = "test-api-key-secret";
export const DEFAULT_API_KEY_SECRET = "endpoint-proxy-api-key-secret";
export const DEFAULT_JWT_SECRET = "pod-default-secret-change-me";
const SECRET_GEN_EXAMPLE = `bun -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"`;

function isBuildPhase(env: NodeJS.ProcessEnv): boolean {
  return env.NEXT_PHASE === "phase-production-build";
}

function isTestEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "test" || env.VITEST === "true";
}

/**
 * Resolve the API key secret from the environment, falling back to a known
 * test value in test environments. Returns `null` in production when no secret
 * is set, so callers can decide whether to throw.
 */
export function resolveApiKeySecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.API_KEY_SECRET?.trim();
  if (value) return value;
  if (isTestEnv(env)) return TEST_API_KEY_SECRET;
  return null;
}

/**
 * Validate that required secrets are configured before the server starts.
 * Throws in production when `JWT_SECRET` or `API_KEY_SECRET` is missing or set
 * to a well-known default. No-op during the Next.js production build phase.
 */
export function validateStartupSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (isBuildPhase(env)) return;

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error(
      `[SECURITY] JWT_SECRET must be set to a strong random value before starting the server. Example: ${SECRET_GEN_EXAMPLE}`,
    );
  }

  const apiKeySecret = resolveApiKeySecret(env);
  if (!apiKeySecret || apiKeySecret === DEFAULT_API_KEY_SECRET) {
    throw new Error(
      `[SECURITY] API_KEY_SECRET must be set to a strong random value before starting the server. Example: ${SECRET_GEN_EXAMPLE}`,
    );
  }
}

/**
 * Read an OAuth client secret from the environment by key. Returns `null` if
 * the variable is missing, not a string, or empty after trimming.
 */
export function getOAuthClientSecret(
  envKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[envKey];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
