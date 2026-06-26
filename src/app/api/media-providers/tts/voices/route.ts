import { asApiRecord, asString } from "@/app/api/_types";
import { NextResponse } from "next/server";
import { VOICE_FETCHERS } from "open-sse/handlers/ttsCore.js";

import { sanitizeError } from "@/lib/sanitizeError";
// Map locale code → country name
const LOCALE_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const LANG_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

function countryName(code) {
  try {
    return LOCALE_NAMES.of(code);
  } catch {
    return code;
  }
}
function langName(code) {
  try {
    return LANG_NAMES.of(code);
  } catch {
    return code;
  }
}

/**
 * GET /api/media-providers/tts/voices
 * Query:
 *   ?provider=edge-tts | local-device | elevenlabs  (default: edge-tts)
 *   ?lang=en     (optional filter by lang code)
 *   ?apiKey=xxx  (required for elevenlabs)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "edge-tts";
    const langFilter = searchParams.get("lang");
    const apiKey = searchParams.get("apiKey");

    const fetcher = VOICE_FETCHERS[provider];
    if (!fetcher) {
      return NextResponse.json({ error: `Provider '${provider}' does not support voice listing` }, { status: 400 });
    }

    // ElevenLabs requires API key
    const raw = (await (provider === "elevenlabs" ? fetcher(apiKey || "") : fetcher(""))) as Record<string, unknown>[];
    const useElevenShape = provider === "elevenlabs" || provider === "gemini";
    let voices;

    if (provider === "local-device") {
      voices = raw.map((item) => {
        const v = item as Record<string, unknown>;
        return {
          id: v.id,
          name: v.name,
          locale: asString(v.locale).replace("_", "-"),
          lang: v.lang,
          country: v.country,
          countryName: countryName(asString(v.country)),
          langName: langName(asString(v.lang)),
          gender: v.gender,
        };
      });
    } else if (useElevenShape) {
      voices = raw.map((item) => {
        const v = item as Record<string, unknown>;
        const labels = asApiRecord(v.labels);
        const language = asString(labels.language) || "en";
        return {
          id: v.voice_id,
          name: v.name,
          locale: language,
          lang: language.split("-")[0],
          country: "",
          countryName: "",
          langName: langName(language.split("-")[0]),
          gender: labels.gender || "",
          category: v.category,
        };
      });
    } else {
      // edge-tts (default)
      voices = raw.map((item) => {
        const v = item as Record<string, unknown>;
        const locale = asString(v.Locale);
        const [lang, country] = locale.split("-");
        return {
          id: v.ShortName,
          name: asString(v.FriendlyName || v.ShortName)
            .replace("Microsoft ", "")
            .replace(/ Online \(Natural\) - /g, " ("),
          locale,
          lang,
          country: country || "",
          countryName: countryName(country || lang),
          langName: langName(lang),
          gender: v.Gender,
        };
      });
    }

    // Apply filter
    if (langFilter) voices = voices.filter((v) => v.lang === langFilter);

    // Group by language
    const byLang = {};
    for (const v of voices) {
      const key = v.lang;
      if (!byLang[key]) byLang[key] = { code: key, name: v.langName, voices: [] };
      byLang[key].voices.push(v);
    }

    // Sorted language list
    const languages = Object.values(byLang).sort((a, b) =>
      (a as { name: string }).name.localeCompare((b as { name: string }).name),
    );

    return NextResponse.json({ voices, languages, byLang });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) || "Failed to fetch voices" }, { status: 502 });
  }
}
