import { AntigravityExecutor } from "./antigravity.ts";
import { AzureExecutor } from "./azure.ts";
import { BaseExecutor } from "./base.ts";
import { CodexExecutor } from "./codex.ts";
import { CommandCodeExecutor } from "./commandcode.ts";
import { CursorExecutor } from "./cursor.ts";
import { DefaultExecutor } from "./default.ts";
import { GeminiCLIExecutor } from "./gemini-cli.ts";
import { GithubExecutor } from "./github.ts";
import { GrokWebExecutor } from "./grok-web.ts";
import { IFlowExecutor } from "./iflow.ts";
import { KiroExecutor } from "./kiro.ts";
import { OllamaLocalExecutor } from "./ollama-local.ts";
import { OpenCodeExecutor } from "./opencode.ts";
import { OpenCodeGoExecutor } from "./opencode-go.ts";
import { PerplexityWebExecutor } from "./perplexity-web.ts";
import { QoderExecutor } from "./qoder.ts";
import { QwenExecutor } from "./qwen.ts";
import { VertexExecutor } from "./vertex.ts";

const executors: Record<string, BaseExecutor> = {
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

const defaultCache = new Map<string, BaseExecutor>();

export function getExecutor(provider: string): BaseExecutor {
  if (executors[provider]) return executors[provider]!;
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider)!;
}

export function hasSpecializedExecutor(provider: string): boolean {
  return !!executors[provider];
}

export { AntigravityExecutor } from "./antigravity.ts";
export { AzureExecutor } from "./azure.ts";
export { BaseExecutor } from "./base.ts";
export { CodexExecutor } from "./codex.ts";
export { CommandCodeExecutor } from "./commandcode.ts";
export { CursorExecutor } from "./cursor.ts";
export { DefaultExecutor } from "./default.ts";
export { GeminiCLIExecutor } from "./gemini-cli.ts";
export { GithubExecutor } from "./github.ts";
export { GrokWebExecutor } from "./grok-web.ts";
export { IFlowExecutor } from "./iflow.ts";
export { KiroExecutor } from "./kiro.ts";
export { OllamaLocalExecutor } from "./ollama-local.ts";
export { OpenCodeExecutor } from "./opencode.ts";
export { OpenCodeGoExecutor } from "./opencode-go.ts";
export { PerplexityWebExecutor } from "./perplexity-web.ts";
export { QoderExecutor } from "./qoder.ts";
export { QwenExecutor } from "./qwen.ts";
export { VertexExecutor } from "./vertex.ts";
