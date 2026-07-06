import { createMemory } from "./store";
import { MemoryType } from "./types";

const PREFERENCE_PATTERNS = [
  /\bI\s+(?:really\s+)?prefer\s+([^.,\n]+)/gi,
  /\bI\s+(?:really\s+)?like\s+([^.,\n]+)/gi,
  /\bmy\s+(?:favorite|favourite)\s+(?:is|are)\s+([^.,\n]+)/gi,
  /\bI\s+(?:don'?t|do\s+not)\s+like\s+([^.,\n]+)/gi,
  /\bI\s+(?:hate|dislike|avoid)\s+([^.,\n]+)/gi,
  /\bI\s+enjoy\s+([^.,\n]+)/gi,
  /\bI\s+love\s+([^.,\n]+)/gi,
  // Indonesian
  /\bsaya\s+(?:suka|menyukai|lebih\s+suka|prefer)\s+([^.,\n]+)/gi,
  /\baku\s+(?:suka|menyukai|lebih\s+suka|prefer)\s+([^.,\n]+)/gi,
  /\bsaya\s+(?:tidak\s+suka|benci|menghindari)\s+([^.,\n]+)/gi,
  /\baku\s+(?:tidak\s+suka|benci|menghindari)\s+([^.,\n]+)/gi,
  /\b(?:favorit|kesukaan)\s+(?:saya|aku)\s+(?:adalah|ialah)?\s*([^.,\n]+)/gi,
];

const DECISION_PATTERNS = [
  /\bI'?(?:ll|will)\s+use\s+([^.,\n]+)/gi,
  /\bI\s+chose\s+([^.,\n]+)/gi,
  /\bI\s+(?:have\s+)?decided\s+(?:to\s+)?([^.,\n]+)/gi,
  /\bI'?m\s+going\s+(?:to\s+)?(?:use|with|adopt)\s+([^.,\n]+)/gi,
  /\bI\s+selected\s+([^.,\n]+)/gi,
  /\bI\s+picked\s+([^.,\n]+)/gi,
  /\bI\s+went\s+with\s+([^.,\n]+)/gi,
  // Indonesian
  /\bsaya\s+(?:akan|mau|ingin)\s+(?:menggunakan|pakai|memakai)\s+([^.,\n]+)/gi,
  /\baku\s+(?:akan|mau|ingin)\s+(?:menggunakan|pakai|memakai)\s+([^.,\n]+)/gi,
  /\bsaya\s+(?:memilih|memutuskan|pilih)\s+([^.,\n]+)/gi,
  /\baku\s+(?:memilih|memutuskan|pilih)\s+([^.,\n]+)/gi,
  /\bpakai\s+([^.,\n]+)\s+(?:saja|aja)/gi,
];

const PATTERN_PATTERNS = [
  /\bI\s+usually\s+([^.,\n]+)/gi,
  /\bI\s+always\s+([^.,\n]+)/gi,
  /\bI\s+never\s+([^.,\n]+)/gi,
  /\bI\s+typically\s+([^.,\n]+)/gi,
  /\bI\s+tend\s+to\s+([^.,\n]+)/gi,
  /\bI\s+(?:often|frequently|regularly)\s+([^.,\n]+)/gi,
  // Indonesian
  /\bsaya\s+(?:biasanya|selalu|sering|rutin)\s+([^.,\n]+)/gi,
  /\baku\s+(?:biasanya|selalu|sering|rutin)\s+([^.,\n]+)/gi,
  /\bsaya\s+tidak\s+pernah\s+([^.,\n]+)/gi,
  /\baku\s+tidak\s+pernah\s+([^.,\n]+)/gi,
];

const MAX_FACT_LENGTH = 500;
const MIN_FACT_LENGTH = 3;
const MAX_EXTRACTION_TEXT_LENGTH = 64 * 1024;

function sanitizeMatch(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_FACT_LENGTH);
}

function capExtractionText(text: string): string {
  if (text.length <= MAX_EXTRACTION_TEXT_LENGTH) return text;
  return text.slice(-MAX_EXTRACTION_TEXT_LENGTH);
}

function factKey(category: string, content: string): string {
  const slug = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40)
    .replace(/_+$/, "");
  return `${category}:${slug}`;
}

type ExtractedFact = { key: string; content: string; type: string; category: string };

function runPatterns(
  text: string,
  patterns: RegExp[],
  category: string,
  type: string,
  seen: Set<string>,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop pattern
    // lgtm[js/polynomial-redos]
    // Input is capped at 64 KB via capExtractionText — practical ReDoS risk is mitigated.
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1];
      if (!raw) continue;
      const content = sanitizeMatch(raw);
      if (content.length < MIN_FACT_LENGTH) continue;
      const key = factKey(category, content);
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ key, content, type, category });
    }
    pattern.lastIndex = 0;
  }
  return facts;
}

export function extractFactsFromText(text: string | null | undefined): ExtractedFact[] {
  if (!text || typeof text !== "string") return [];
  const cappedText = capExtractionText(text);
  const seen = new Set<string>();
  const facts: ExtractedFact[] = [];
  facts.push(
    ...runPatterns(cappedText, PREFERENCE_PATTERNS, "preference", MemoryType.FACTUAL, seen),
  );
  facts.push(...runPatterns(cappedText, DECISION_PATTERNS, "decision", MemoryType.EPISODIC, seen));
  facts.push(...runPatterns(cappedText, PATTERN_PATTERNS, "pattern", MemoryType.FACTUAL, seen));
  return facts;
}

export function extractFacts(text: string, apiKeyId: string, sessionId: string): void {
  if (!text || !apiKeyId || !sessionId) return;
  const cappedText = capExtractionText(text);

  setImmediate(async () => {
    try {
      const facts = extractFactsFromText(cappedText);
      if (facts.length === 0) return;

      const results = await Promise.allSettled(
        facts.map((fact) =>
          createMemory({
            apiKeyId,
            sessionId,
            type: fact.type,
            key: fact.key,
            content: fact.content,
            metadata: {
              category: fact.category,
              extractedAt: new Date().toISOString(),
              source: "llm_response",
            },
            expiresAt: null,
          }),
        ),
      );

      const rejected = results.filter((r) => r.status === "rejected");
      if (rejected.length > 0) {
        console.warn(
          "[extraction] Memory creation errors:",
          rejected.map((r) => r.reason),
        );
      }
    } catch (err) {
      console.warn("[extraction] Background extraction failed:", err);
    }
  });
}
