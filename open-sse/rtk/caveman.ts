// Caveman injector: appends a caveman-style instruction into the system message
// of the final request body, just before it is dispatched to the provider executor.

import { CAVEMAN_PROMPTS } from "./cavemanPrompts.ts";
import { injectSystemPrompt } from "./systemInject.ts";

export function injectCaveman(
  body: Record<string, unknown> | null | undefined,
  format: string,
  level: string,
): void {
  const prompt = (CAVEMAN_PROMPTS as Record<string, string | undefined>)[level];
  injectSystemPrompt(body, format, prompt);
}
