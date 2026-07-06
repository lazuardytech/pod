import { NextResponse } from "next/server";
import { fetchElevenLabsVoices } from "open-sse/handlers/ttsCore.js";
import { asString } from "@/app/api/_types";
import { getProviderConnections } from "@/lib/localDb";

import { sanitizeError } from "@/lib/sanitizeError";

const langNames = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * GET /api/media-providers/tts/elevenlabs/voices[?lang=en]
 * Returns { languages, byLang } grouped by language - same format as edge-tts
 * Uses direct DB read (no mutex) to avoid blocking on concurrent TTS requests
 */
export async function GET(request: any) {
  try {
    const { searchParams } = new URL(request.url);
    const langFilter = searchParams.get("lang");

    // Direct DB read - bypass auth mutex used for TTS inference
    const connections = await getProviderConnections({ provider: "elevenlabs", isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) {
      return NextResponse.json({ error: "No ElevenLabs connection found" }, { status: 400 });
    }

    const voices = await fetchElevenLabsVoices(asString(apiKey));

    // Group by all supported languages (verified_languages + labels.language)
    const byLang: Record<
      string,
      {
        code: string;
        name: string;
        voices: {
          id: string;
          name: string;
          gender: string;
          lang: string;
          free_users_allowed?: boolean;
        }[];
      }
    > = {};
    const addToLang = (code: any, voice: any) => {
      if (!byLang[code]) {
        byLang[code] = {
          code,
          name: (() => {
            try {
              return langNames.of(code);
            } catch {
              return code;
            }
          })(),
          voices: [],
        };
      }
      // Avoid duplicate voice in same lang
      if (!byLang[code].voices.find((v: any) => v.id === voice.voice_id)) {
        byLang[code].voices.push({
          id: voice.voice_id,
          name: (voice as any).name,
          gender: voice.labels?.gender || "",
          lang: code,
          // premade voices are free; professional library voices added to account may require paid plan
          free_users_allowed: voice.category === "premade" || voice.is_owner === true,
        });
      }
    };
    const voiceList = voices as Record<string, unknown>[];
    for (const v of voiceList) {
      const labels = (v.labels as Record<string, unknown>) || {};
      const primaryLang = (labels.language as string) || "en";
      addToLang(primaryLang, v);
      // Add to all verified languages
      for (const vl of (v.verified_languages as Record<string, unknown>[]) || []) {
        if (vl.language && vl.language !== primaryLang) {
          addToLang(vl.language as string, v);
        }
      }
    }

    const languages = Object.values(byLang).sort((a, b) =>
      (a as { name: string }).name.localeCompare((b as { name: string }).name),
    );

    // If lang filter requested, return only that group's voices
    if (langFilter) {
      return NextResponse.json({
        voices: (byLang as Record<string, any>)[langFilter]?.voices || [],
      });
    }

    return NextResponse.json({ languages, byLang });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeError(err) || "Failed to fetch voices" },
      { status: 502 },
    );
  }
}
