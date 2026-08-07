import {
  GEMINI_CLI_API_CLIENT,
  geminiCLIUserAgent,
  OAUTH_ENDPOINTS,
} from "../config/appConstants.js";
import { PROVIDERS } from "../config/providers.js";
import {
  BaseExecutor,
  type ExecutorConfigInput,
  type ExecutorCredentials,
  type ExecutorHeaders,
  type ExecutorLogger,
} from "./base.js";

export class GeminiCLIExecutor extends BaseExecutor {
  private _currentModel: string | null = null;

  constructor() {
    super(
      "gemini-cli",
      (PROVIDERS as Record<string, ExecutorConfigInput>)["gemini-cli"]!,
    );
  }

  buildUrl(model: string, stream: boolean, _urlIndex: number = 0): string {
    void model;
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT,
      Accept: stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(
    model: string,
    body: unknown,
    stream: boolean,
    credentials: ExecutorCredentials,
  ): unknown {
    void stream;
    // Store model for use in buildHeaders (called by base.execute after transformRequest)
    this._currentModel = model;
    const record = body as Record<string, unknown>;
    if (!record.project && credentials?.projectId) {
      record.project = credentials.projectId;
    }
    return record;
  }

  async refreshCredentials(
    credentials: ExecutorCredentials,
    log: ExecutorLogger | null,
  ): Promise<ExecutorCredentials | null> {
    if (!credentials.refreshToken) return null;

    try {
      const tokenBody: Record<string, string> = {
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        client_id: String(this.config.clientId),
        client_secret: String(this.config.clientSecret),
      };
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(tokenBody),
      });

      if (!response.ok) return null;

      const tokens = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${message}`);
      return null;
    }
  }
}

export default GeminiCLIExecutor;
