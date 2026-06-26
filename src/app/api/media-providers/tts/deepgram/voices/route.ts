import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

import { sanitizeError } from "@/lib/sanitizeError";
const langNames = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * GET /api/media-providers/tts/deepgram/voices[?lang=en]
 * Returns { languages, byLang } grouped by language code (same shape as edge-tts/elevenlabs/inworld)
 * Each Deepgram voice = one model (canonical_name like "aura-2-thalia-en")
 */
export async function GET(request: any) {
  try {
    const { searchParams } = new URL(request.url);
    const langFilter = searchParams.get("lang");

    const connections = await getProviderConnections({ provider: "deepgram", isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) return NextResponse.json({ error: "No Deepgram connection found" }, { status: 400 });

    const res = await fetch("https://api.deepgram.com/v1/models", {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Deepgram API returned status ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    const ttsModels = data.tts || [];

    const byLang: Record<string, { code: string; name: string; voices: { id: string; name: string; gender: string; lang: string }[] }> = {};
    for (const m of ttsModels) {
      // Deepgram returns `languages: ["en"]` or sometimes language inferred from canonical_name suffix
      const langs =
        Array.isArray(m.languages) && m.languages.length ? m.languages : [m.canonical_name?.split("-").pop() || "en"];
      for (const code of langs) {
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
        const voiceId = m.canonical_name || (m as any).name;
        if (!byLang[code].voices.find((x: any) => x.id === voiceId)) {
          byLang[code].voices.push({
            id: voiceId,
            name: m.name || voiceId,
            gender: m.metadata?.tags?.find((t: any) => t === "masculine" || t === "feminine") || "",
            lang: code,
          });
        }
      }
    }

    const languages = Object.values(byLang).sort((a, b) =>
      (a as { name: string }).name.localeCompare((b as { name: string }).name),
    );

    if (langFilter) {
      return NextResponse.json({ voices: (byLang as Record<string, any>)[langFilter]?.voices || [] });
    }
    return NextResponse.json({ languages, byLang });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) || "Failed to fetch voices" }, { status: 502 });
  }
}
