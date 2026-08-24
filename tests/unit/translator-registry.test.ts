import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.ts";
import {
  getRegisteredRequestTranslatorKeys,
  getRegisteredResponseTranslatorKeys,
} from "../../open-sse/translator/index.ts";

function key(from: string, to: string) {
  return `${from}:${to}`;
}

describe("translator registry", () => {
  it("does not register undefined format keys", () => {
    const keys = [
      ...getRegisteredRequestTranslatorKeys(),
      ...getRegisteredResponseTranslatorKeys(),
    ];

    expect(keys.filter((value) => value.includes("undefined"))).toEqual([]);
  });

  it("registers all request translators loaded by translator/loaders", () => {
    expect([...getRegisteredRequestTranslatorKeys()].sort()).toEqual(
      [
        key(FORMATS.ANTIGRAVITY, FORMATS.OPENAI),
        key(FORMATS.CLAUDE, FORMATS.OPENAI),
        key(FORMATS.GEMINI, FORMATS.OPENAI),
        key(FORMATS.GEMINI_CLI, FORMATS.OPENAI),
        key(FORMATS.OPENAI, FORMATS.ANTIGRAVITY),
        key(FORMATS.OPENAI, FORMATS.CLAUDE),
        key(FORMATS.OPENAI, FORMATS.COMMANDCODE),
        key(FORMATS.OPENAI, FORMATS.CURSOR),
        key(FORMATS.OPENAI, FORMATS.GEMINI),
        key(FORMATS.OPENAI, FORMATS.GEMINI_CLI),
        key(FORMATS.OPENAI, FORMATS.KIRO),
        key(FORMATS.OPENAI, FORMATS.OLLAMA),
        key(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES),
        key(FORMATS.OPENAI, FORMATS.VERTEX),
        key(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI),
      ].sort(),
    );
  });

  it("registers all response translators loaded by translator/loaders", () => {
    expect([...getRegisteredResponseTranslatorKeys()].sort()).toEqual(
      [
        key(FORMATS.ANTIGRAVITY, FORMATS.OPENAI),
        key(FORMATS.CLAUDE, FORMATS.OPENAI),
        key(FORMATS.COMMANDCODE, FORMATS.OPENAI),
        key(FORMATS.CURSOR, FORMATS.OPENAI),
        key(FORMATS.GEMINI, FORMATS.OPENAI),
        key(FORMATS.GEMINI_CLI, FORMATS.OPENAI),
        key(FORMATS.KIRO, FORMATS.OPENAI),
        key(FORMATS.OLLAMA, FORMATS.OPENAI),
        key(FORMATS.OPENAI, FORMATS.ANTIGRAVITY),
        key(FORMATS.OPENAI, FORMATS.CLAUDE),
        key(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES),
        key(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI),
        key(FORMATS.VERTEX, FORMATS.OPENAI),
      ].sort(),
    );
  });
});
