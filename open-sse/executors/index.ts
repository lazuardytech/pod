import { AntigravityExecutor } from "./antigravity.js";
import { AzureExecutor } from "./azure.js";
import { CodexExecutor } from "./codex.js";
import { CommandCodeExecutor } from "./commandcode.js";
import { CursorExecutor } from "./cursor.js";
import { DefaultExecutor } from "./default.js";
import { GeminiCLIExecutor } from "./gemini-cli.js";
import { GithubExecutor } from "./github.js";
import { GrokWebExecutor } from "./grok-web.js";
import { IFlowExecutor } from "./iflow.js";
import { KiroExecutor } from "./kiro.js";
import { OllamaLocalExecutor } from "./ollama-local.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeGoExecutor } from "./opencode-go.js";
import { PerplexityWebExecutor } from "./perplexity-web.js";
import { QoderExecutor } from "./qoder.js";
import { QwenExecutor } from "./qwen.js";
import { VertexExecutor } from "./vertex.js";

const executors = {
  antigravity: new AntigravityExecutor(),
  azure: new AzureExecutor(),
  "gemini-cli": new GeminiCLIExecutor(),
  github: new GithubExecutor(),
  iflow: new IFlowExecutor(),
  qoder: new QoderExecutor(),
  kiro: new KiroExecutor(),
  codex: new CodexExecutor(),
  cursor: new CursorExecutor(),
  cu: new CursorExecutor(), // Alias for cursor
  vertex: new VertexExecutor("vertex"),
  "vertex-partner": new VertexExecutor("vertex-partner"),
  qwen: new QwenExecutor(),
  opencode: new OpenCodeExecutor(),
  "opencode-go": new OpenCodeGoExecutor(),
  "grok-web": new GrokWebExecutor(),
  "perplexity-web": new PerplexityWebExecutor(),
  "ollama-local": new OllamaLocalExecutor(),
  commandcode: new CommandCodeExecutor(),
};

const defaultCache = new Map();

export function getExecutor(provider: any) {
  if (executors[provider]) return executors[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider: any) {
  return !!executors[provider];
}

export { AntigravityExecutor } from "./antigravity.js";
export { AzureExecutor } from "./azure.js";
export { BaseExecutor } from "./base.js";
export { CodexExecutor } from "./codex.js";
export { CommandCodeExecutor } from "./commandcode.js";
export { CursorExecutor } from "./cursor.js";
export { DefaultExecutor } from "./default.js";
export { GeminiCLIExecutor } from "./gemini-cli.js";
export { GithubExecutor } from "./github.js";
export { GrokWebExecutor } from "./grok-web.js";
export { IFlowExecutor } from "./iflow.js";
export { KiroExecutor } from "./kiro.js";
export { OllamaLocalExecutor } from "./ollama-local.js";
export { OpenCodeExecutor } from "./opencode.js";
export { OpenCodeGoExecutor } from "./opencode-go.js";
export { PerplexityWebExecutor } from "./perplexity-web.js";
export { QoderExecutor } from "./qoder.js";
export { QwenExecutor } from "./qwen.js";
export { VertexExecutor } from "./vertex.js";
