// Ponytail injector: appends the "lazy senior dev" instruction into the system
// message of the final request body, just before dispatch to the provider executor.

import { PONYTAIL_PROMPTS, type PonytailLevel } from "./ponytailPrompt.ts";
import { injectSystemPrompt } from "./systemInject.ts";

export function injectPonytail(
  body: Record<string, unknown> | null | undefined,
  format: string,
  level: string,
): void {
  const prompt = PONYTAIL_PROMPTS[level as PonytailLevel];
  injectSystemPrompt(body, format, prompt);
}
