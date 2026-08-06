import {
  GEMINI_CLI_API_CLIENT,
  geminiCLIUserAgent,
  OAUTH_ENDPOINTS,
} from "../config/appConstants.js";
import { PROVIDERS } from "../config/providers.js";
import { BaseExecutor } from "./base.js";

export class GeminiCLIExecutor extends BaseExecutor {
  constructor() {
    super("gemini-cli", PROVIDERS["gemini-cli"]);
  }

  buildUrl(model: any, stream: any, urlIndex: any = 0) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  buildHeaders(credentials: any, stream: any = true) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT,
      Accept: stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(model: any, body: any, stream: any, credentials: any) {
    // Store model for use in buildHeaders (called by base.execute after transformRequest)
    this._currentModel = model;
    if (!body.project && credentials?.projectId) {
      body.project = credentials.projectId;
    }
    return body;
  }

  async refreshCredentials(credentials: any, log: any) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId,
      };
    } catch (error: any) {
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${error.message}`);
      return null;
    }
  }
}

export default GeminiCLIExecutor;
