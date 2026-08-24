// Re-export from open-sse with worker logger
import * as log from "../utils/logger.ts";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshTokenByProvider as _refreshTokenByProvider,
} from "open-sse/services/tokenRefresh.ts";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;

export const refreshTokenByProvider = (provider: string, credentials: Record<string, unknown>) =>
  _refreshTokenByProvider(provider, credentials, log);
