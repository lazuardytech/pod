// TTS provider registry

import { parseModelVoice } from "./_base.ts";
import edgeTts, { fetchEdgeTtsVoices } from "./edgeTts.ts";
import elevenlabs, { fetchElevenLabsVoices } from "./elevenlabs.ts";
import gemini, { fetchGeminiVoices } from "./gemini.ts";
import { FORMAT_HANDLERS } from "./genericFormats.ts";
import googleTts from "./googleTts.ts";
import localDevice, { fetchLocalDeviceVoices } from "./localDevice.ts";
import openai from "./openai.ts";
import openrouter from "./openrouter.ts";

type TtsAdapterResult =
  | { base64: string; format: string; success?: undefined }
  | { response: Response; success: true };
type TtsAdapter = { synthesize: (...args: unknown[]) => Promise<TtsAdapterResult> };
type TtsConfigResult = { base64: string; format: string } | null;

// Special providers with custom synthesize() logic
const SPECIAL_ADAPTERS = {
  "google-tts": googleTts,
  "edge-tts": edgeTts,
  "local-device": localDevice,
  elevenlabs,
  openai,
  openrouter,
  gemini,
} as unknown as Record<string, TtsAdapter>;

export function getTtsAdapter(provider: string): TtsAdapter | null {
  return SPECIAL_ADAPTERS[provider] || null;
}

// Generic config-driven dispatcher (uses ttsConfig.format)
export async function synthesizeViaConfig(
  provider: string,
  text: string,
  model: string,
  credentials: { apiKey?: string } | null | undefined,
): Promise<TtsConfigResult> {
  const { AI_PROVIDERS } = await import("@/shared/constants/providers");
  const cfg = AI_PROVIDERS[provider]?.ttsConfig;
  if (!cfg) return null;
  const handler = (
    FORMAT_HANDLERS as Record<
      string,
      (args: {
        baseUrl: string;
        apiKey?: string;
        text: string;
        modelId?: string;
        voiceId?: string;
      }) => Promise<{ base64: string; format: string }>
    >
  )[cfg.format];
  if (!handler) return null;
  const apiKey = credentials?.apiKey;
  if (cfg.authType !== "none" && !apiKey) throw new Error(`${provider} API key required`);
  const defaultModel = cfg.models?.[0]?.id || "";
  const { modelId, voiceId } = parseModelVoice(model, defaultModel, "", cfg.models || []);
  return handler({ baseUrl: cfg.baseUrl, apiKey, text, modelId, voiceId });
}

// Voice fetchers (used by /api/media-providers/tts/voices route)
export const VOICE_FETCHERS = {
  "edge-tts": fetchEdgeTtsVoices,
  "local-device": fetchLocalDeviceVoices,
  elevenlabs: fetchElevenLabsVoices,
  gemini: fetchGeminiVoices,
} as unknown as Record<string, (apiKey?: string) => Promise<unknown>>;

// Re-export for backward compat
export { fetchEdgeTtsVoices, fetchElevenLabsVoices, fetchGeminiVoices, fetchLocalDeviceVoices };
