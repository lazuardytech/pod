import { resolveOllamaLocalHost } from "../config/providers.js";
import { DefaultExecutor } from "./default.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(model: any, stream: any, urlIndex: any = 0, credentials: any = null) {
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }
}

export default OllamaLocalExecutor;
