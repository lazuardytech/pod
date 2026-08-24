/**
 * Unit tests for open-sse/handlers/embeddingProviders/gemini.js
 *
 * Verifies request body construction, esp. outputDimensionality forwarding.
 */

import { describe, expect, it } from "vitest";
import geminiAdapter from "../../open-sse/handlers/embeddingProviders/gemini.ts";

describe("Gemini embedding adapter", () => {
  describe("buildBody", () => {
    it("builds single-input body without outputDimensionality when dimensions is missing", () => {
      const body = geminiAdapter.buildBody("text-embedding-004", { input: "hello" });
      expect(body).toEqual({
        model: "models/text-embedding-004",
        content: { parts: [{ text: "hello" }] },
      });
      expect("outputDimensionality" in body).toBe(false);
    });

    it("forwards numeric dimensions as outputDimensionality on single input", () => {
      const body = geminiAdapter.buildBody("text-embedding-004", {
        input: "hello",
        dimensions: 256,
      });
      expect(body).toEqual({
        model: "models/text-embedding-004",
        content: { parts: [{ text: "hello" }] },
        outputDimensionality: 256,
      });
    });

    it("coerces numeric string dimensions like '256' to a number", () => {
      const body = geminiAdapter.buildBody("text-embedding-004", {
        input: "hello",
        dimensions: "256",
      });
      expect(body.outputDimensionality).toBe(256);
    });

    it("ignores empty-string and zero/negative dimensions", () => {
      for (const bad of ["", 0, -1, "abc", null]) {
        const body = geminiAdapter.buildBody("text-embedding-004", {
          input: "hello",
          dimensions: bad,
        });
        expect("outputDimensionality" in body).toBe(false);
      }
    });

    it("forwards outputDimensionality to every entry in batchEmbedContents requests array", () => {
      const body = geminiAdapter.buildBody("text-embedding-004", {
        input: ["a", "b", "c"],
        dimensions: 512,
      });
      expect(Array.isArray(body.requests)).toBe(true);
      expect(body.requests).toHaveLength(3);
      for (const r of body.requests) {
        expect(r.outputDimensionality).toBe(512);
        expect(r.model).toBe("models/text-embedding-004");
      }
    });

    it("preserves model path when caller already passed `models/...`", () => {
      const body = geminiAdapter.buildBody("models/text-embedding-004", { input: "hi" });
      expect(body.model).toBe("models/text-embedding-004");
    });
  });
});
