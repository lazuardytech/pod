declare module "open-sse/index.js" {
  export function getExecutor(provider: string): unknown;
  export function refreshTokenByProvider(
    provider: string,
    credentials: unknown,
    log?: unknown,
  ): Promise<unknown>;
}

declare module "open-sse/services/combo.js" {
  export function resetComboRotation(comboName?: string): void;
}

declare module "open-sse/handlers/ttsCore.js" {
  export function fetchElevenLabsVoices(apiKey: string): Promise<unknown>;
  export const VOICE_FETCHERS: Record<string, (apiKey: string) => Promise<unknown>>;
}

declare module "open-sse/translator/formats.js" {
  export const FORMATS: Record<string, string>;
}
