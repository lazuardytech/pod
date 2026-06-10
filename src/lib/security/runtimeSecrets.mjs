const TEST_API_KEY_SECRET = "test-api-key-secret";
export const DEFAULT_API_KEY_SECRET = "endpoint-proxy-api-key-secret";
export const DEFAULT_JWT_SECRET = "pod-default-secret-change-me";
const SECRET_GEN_EXAMPLE = `bun -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"`;

function isBuildPhase(env) {
  return env.NEXT_PHASE === "phase-production-build";
}

function isTestEnv(env) {
  return env.NODE_ENV === "test" || env.VITEST === "true";
}

export function resolveApiKeySecret(env = process.env) {
  const value = env.API_KEY_SECRET?.trim();
  if (value) return value;
  if (isTestEnv(env)) return TEST_API_KEY_SECRET;
  return null;
}

export function validateStartupSecrets(env = process.env) {
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

export function getOAuthClientSecret(envKey, env = process.env) {
  const value = env[envKey];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
