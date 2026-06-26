import { getProjectIdForConnection, invalidateProjectId, removeConnection } from "open-sse/services/projectId.js";
import {
  formatProviderCredentials as _formatProviderCredentials,
  getAccessToken as _getAccessToken,
  getAllAccessTokens as _getAllAccessTokens,
  getRefreshLeadMs as _getRefreshLeadMs,
  refreshAccessToken as _refreshAccessToken,
  refreshClaudeOAuthToken as _refreshClaudeOAuthToken,
  refreshCodexToken as _refreshCodexToken,
  refreshCopilotToken as _refreshCopilotToken,
  refreshGitHubToken as _refreshGitHubToken,
  refreshGoogleToken as _refreshGoogleToken,
  refreshIflowToken as _refreshIflowToken,
  refreshKiroToken as _refreshKiroToken,
  refreshQwenToken as _refreshQwenToken,
  refreshTokenByProvider as _refreshTokenByProvider,
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
} from "open-sse/services/tokenRefresh.js";
import { updateProviderConnection } from "@/lib/localDb";
import * as log from "../utils/logger";

export const TOKEN_EXPIRY_BUFFER_MS: number = BUFFER_MS;
type AnyCreds = Record<string, any>;
export const refreshAccessToken = (provider: string, refreshToken: string, credentials: AnyCreds): Promise<AnyCreds> =>
  _refreshAccessToken(provider, refreshToken, credentials, log);
export const refreshClaudeOAuthToken = (refreshToken: string): Promise<AnyCreds> =>
  _refreshClaudeOAuthToken(refreshToken, log);
export const refreshGoogleToken = (refreshToken: string, clientId: string, clientSecret: string): Promise<AnyCreds> =>
  _refreshGoogleToken(refreshToken, clientId, clientSecret, log);
export const refreshQwenToken = (refreshToken: string): Promise<AnyCreds> => _refreshQwenToken(refreshToken, log);
export const refreshCodexToken = (refreshToken: string): Promise<AnyCreds> => _refreshCodexToken(refreshToken, log);
export const refreshIflowToken = (refreshToken: string): Promise<AnyCreds> => _refreshIflowToken(refreshToken, log);
export const refreshGitHubToken = (refreshToken: string): Promise<AnyCreds> => _refreshGitHubToken(refreshToken, log);
export const refreshCopilotToken = (githubAccessToken: string): Promise<{ token: string; expiresAt: number } | null> =>
  _refreshCopilotToken(githubAccessToken, log);
export const refreshKiroToken = (refreshToken: string, providerSpecificData: AnyCreds | undefined): Promise<AnyCreds> =>
  _refreshKiroToken(refreshToken, providerSpecificData, log);
export const getAccessToken = (provider: string, credentials: AnyCreds): Promise<AnyCreds> =>
  _getAccessToken(provider, credentials, log);
export const refreshTokenByProvider = (provider: string, credentials: AnyCreds): Promise<AnyCreds> =>
  _refreshTokenByProvider(provider, credentials, log);
export const formatProviderCredentials = (provider: string, credentials: AnyCreds): string =>
  _formatProviderCredentials(provider, credentials, log);
export const getAllAccessTokens = (userInfo: unknown): unknown => _getAllAccessTokens(userInfo, log);
export function releaseConnection(connectionId: string): void {
  if (!connectionId) return;
  removeConnection(connectionId);
  log.debug("TOKEN_REFRESH", "Released connection resources", { connectionId });
}
function toExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}
function needsProjectId(provider: string): boolean {
  return provider === "antigravity" || provider === "gemini-cli";
}
function _refreshProjectId(provider: string, connectionId: string, accessToken: string): void {
  if (!needsProjectId(provider) || !connectionId || !accessToken) return;
  invalidateProjectId(connectionId);
  getProjectIdForConnection(connectionId, accessToken)
    .then((projectId) => {
      if (!projectId) return;
      updateProviderCredentials(connectionId, { projectId }).catch((err: unknown) => {
        log.debug("TOKEN_REFRESH", "Failed to persist refreshed projectId", {
          connectionId,
          error: (err as { message?: string })?.message ?? err,
        });
      });
    })
    .catch((err: unknown) => {
      log.debug("TOKEN_REFRESH", "Failed to fetch projectId after token refresh", {
        connectionId,
        error: (err as { message?: string })?.message ?? err,
      });
    });
}
export type NewCredentials = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  providerSpecificData?: Record<string, unknown>;
  existingProviderSpecificData?: Record<string, unknown>;
  projectId?: string;
  testStatus?: string;
};
export async function updateProviderCredentials(
  connectionId: string,
  newCredentials: NewCredentials,
): Promise<boolean> {
  try {
    const updates: Record<string, unknown> = {};
    if (newCredentials.accessToken) updates.accessToken = newCredentials.accessToken;
    if (newCredentials.refreshToken) updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn);
      updates.expiresIn = newCredentials.expiresIn;
    }
    if (newCredentials.providerSpecificData) {
      updates.providerSpecificData = {
        ...(newCredentials.existingProviderSpecificData || {}),
        ...newCredentials.providerSpecificData,
      };
    }
    if (newCredentials.projectId) updates.projectId = newCredentials.projectId;
    if (newCredentials.testStatus) updates.testStatus = newCredentials.testStatus;
    const result = await updateProviderConnection(connectionId, updates);
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", { connectionId, success: !!result });
    return !!result;
  } catch (error) {
    log.error("TOKEN_REFRESH", "Error updating credentials in localDb", {
      connectionId,
      error: (error as Error).message,
    });
    return false;
  }
}
const inflightRefresh = new Map<string, Promise<AnyCreds>>();
export async function checkAndRefreshToken(provider: string, credentials: AnyCreds): Promise<AnyCreds> {
  const connId = credentials?.connectionId;
  if (connId && inflightRefresh.has(connId)) return inflightRefresh.get(connId) as Promise<AnyCreds>;
  const work = _doCheckAndRefresh(provider, credentials);
  if (connId) {
    inflightRefresh.set(connId, work);
    work.then(
      () => inflightRefresh.delete(connId),
      () => inflightRefresh.delete(connId),
    );
  }
  return work;
}
async function _doCheckAndRefresh(provider: string, credentials: AnyCreds): Promise<AnyCreds> {
  let creds: AnyCreds = { ...credentials };
  if (creds.expiresAt) {
    const expiresAt = new Date(creds.expiresAt).getTime();
    const now = Date.now();
    const remaining = expiresAt - now;
    const refreshLead = _getRefreshLeadMs(provider);
    if (remaining < refreshLead) {
      log.info("TOKEN_REFRESH", "Token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
        refreshLeadMs: refreshLead,
      });
      const newCreds = await getAccessToken(provider, creds);
      if (newCreds?.accessToken) {
        const mergedCreds = { ...newCreds, existingProviderSpecificData: creds.providerSpecificData };
        await updateProviderCredentials(creds.connectionId, mergedCreds);
        creds = {
          ...creds,
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken ?? creds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData
            ? { ...creds.providerSpecificData, ...newCreds.providerSpecificData }
            : creds.providerSpecificData,
          expiresAt: newCreds.expiresIn ? toExpiresAt(newCreds.expiresIn) : creds.expiresAt,
        };
        _refreshProjectId(provider, creds.connectionId, creds.accessToken);
      }
    }
  }
  if (provider === "github" && creds.providerSpecificData?.copilotTokenExpiresAt) {
    const copilotExpiresAt = creds.providerSpecificData.copilotTokenExpiresAt * 1000;
    const now = Date.now();
    const remaining = copilotExpiresAt - now;
    if (remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
      });
      const copilotToken = await refreshCopilotToken(creds.accessToken);
      if (copilotToken) {
        const updatedSpecific = {
          ...creds.providerSpecificData,
          copilotToken: copilotToken.token,
          copilotTokenExpiresAt: copilotToken.expiresAt,
        };
        await updateProviderCredentials(creds.connectionId, { providerSpecificData: updatedSpecific });
        creds.providerSpecificData = updatedSpecific;
        creds.copilotToken = copilotToken.token;
      }
    }
  }
  return creds;
}
export async function refreshGitHubAndCopilotTokens(credentials: AnyCreds): Promise<AnyCreds> {
  const newGitHubCreds = await refreshGitHubToken(credentials.refreshToken);
  if (!newGitHubCreds?.accessToken) return newGitHubCreds;
  const copilotToken = await refreshCopilotToken(newGitHubCreds.accessToken);
  if (!copilotToken) return newGitHubCreds;
  return {
    ...newGitHubCreds,
    providerSpecificData: {
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt,
    },
  };
}
