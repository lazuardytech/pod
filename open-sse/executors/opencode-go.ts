import { PROVIDERS } from "../config/providers.ts";
import { injectReasoningContent } from "../utils/reasoningContentInjector.ts";
import {
  BaseExecutor,
  type ExecutorConfigInput,
  type ExecutorCredentials,
  type ExecutorHeaders,
} from "./base.ts";

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const CLAUDE_FORMAT_MODELS = new Set(["minimax-m2.5", "minimax-m2.7"]);

const BASE = "https://opencode.ai/zen/go/v1";

export class OpenCodeGoExecutor extends BaseExecutor {
  private _lastModel: string | null = null;

  constructor() {
    super("opencode-go", (PROVIDERS as Record<string, ExecutorConfigInput>)["opencode-go"]!);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache model here
  buildUrl(
    model: string,
    _stream?: boolean,
    _urlIndex?: number,
    _credentials?: ExecutorCredentials | null,
  ): string {
    this._lastModel = model;
    return CLAUDE_FORMAT_MODELS.has(model) ? `${BASE}/messages` : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers: ExecutorHeaders = { "Content-Type": "application/json" };

    if (this._lastModel && CLAUDE_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key as string;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model: string, body: unknown): unknown {
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
