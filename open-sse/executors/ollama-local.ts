import { resolveOllamaLocalHost } from "../config/providers.js";
import type { ExecutorCredentials } from "./base.js";
import { DefaultExecutor } from "./default.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(
    _model: string,
    _stream: boolean,
    _urlIndex: number = 0,
    credentials: ExecutorCredentials | null = null,
  ) {
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }
}

export default OllamaLocalExecutor;
