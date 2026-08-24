/**
 * Unit tests for open-sse/translator/request/openai-to-claude.js
 *
 * Tests cover:
 *  - openaiToClaudeRequest() - OpenAI to Claude request translation
 *  - Response format handling (json_schema, json_object)
 */

import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.ts";

describe("openaiToClaudeRequest", () => {
  describe("response_format handling", () => {
    it("should inject JSON schema instructions for json_schema type", () => {
      const body = {
        messages: [{ role: "user", content: "What is 2+2?" }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "math_response",
            schema: {
              type: "object",
              properties: {
                answer: { type: "number" },
                explanation: { type: "string" },
              },
              required: ["answer", "explanation"],
            },
          },
        },
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system array with instructions
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);

      // Check that system prompt includes schema
      const systemText = result.system
        .filter((s) => s.type === "text")
        .map((s) => s.text)
        .join("\n");

      expect(systemText).toContain("You must respond with valid JSON");
      expect(systemText).toContain('"answer"');
      expect(systemText).toContain('"explanation"');
      expect(systemText).toContain("Respond ONLY with the JSON object");
    });

    it("should inject basic JSON instructions for json_object type", () => {
      const body = {
        messages: [{ role: "user", content: "Give me a JSON object" }],
        response_format: {
          type: "json_object",
        },
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system array with instructions
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);

      const systemText = result.system
        .filter((s) => s.type === "text")
        .map((s) => s.text)
        .join("\n");

      expect(systemText).toContain("You must respond with valid JSON");
      expect(systemText).toContain("Respond ONLY with a JSON object");
    });

    it("should not modify system prompt when response_format is missing", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system but without JSON instructions
      expect(result.system).toBeDefined();

      const systemText = result.system
        .filter((s) => s.type === "text")
        .map((s) => s.text)
        .join("\n");

      // Should NOT contain JSON-specific instructions
      expect(systemText).not.toContain("You must respond with valid JSON");
    });

    it("should preserve existing system messages when adding response_format", () => {
      const body = {
        messages: [
          { role: "system", content: "You are a helpful math tutor." },
          { role: "user", content: "What is 2+2?" },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "object",
              properties: {
                result: { type: "number" },
              },
            },
          },
        },
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should preserve original system message
      const systemText = result.system
        .filter((s) => s.type === "text")
        .map((s) => s.text)
        .join("\n");

      expect(systemText).toContain("You are a helpful math tutor");
      expect(systemText).toContain("You must respond with valid JSON");
    });
  });

  describe("Read tool argument sanitization", () => {
    const readTool = {
      type: "function",
      function: {
        name: "Read",
        description: "Read a file",
        parameters: { type: "object", properties: { file_path: { type: "string" } } },
      },
    };

    it("strips empty pages from tool_calls before forwarding to Claude", () => {
      const body = {
        tools: [readTool],
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "toolu_1",
                type: "function",
                function: {
                  name: "Read",
                  arguments: JSON.stringify({ file_path: "/etc/hosts", pages: "" }),
                },
              },
            ],
          },
        ],
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
      const toolUse = result.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((b) => b?.type === "tool_use");

      expect(toolUse).toBeDefined();
      expect(toolUse.name).toBe("Read");
      expect(toolUse.input).toEqual({ file_path: "/etc/hosts" });
      expect("pages" in toolUse.input).toBe(false);
    });

    it("keeps valid pages range like '1-3' on Read", () => {
      const body = {
        tools: [readTool],
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "toolu_2",
                type: "function",
                function: {
                  name: "Read",
                  arguments: JSON.stringify({ file_path: "/tmp/doc.pdf", pages: "1-3" }),
                },
              },
            ],
          },
        ],
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
      const toolUse = result.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((b) => b?.type === "tool_use");

      expect(toolUse.input.pages).toBe("1-3");
    });

    it("coerces numeric string limit/offset to numbers", () => {
      const body = {
        tools: [readTool],
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "toolu_3",
                type: "function",
                function: {
                  name: "Read",
                  arguments: JSON.stringify({ file_path: "/etc/hosts", limit: "100", offset: "5" }),
                },
              },
            ],
          },
        ],
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
      const toolUse = result.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((b) => b?.type === "tool_use");

      expect(toolUse.input.limit).toBe(100);
      expect(toolUse.input.offset).toBe(5);
    });

    it("does not touch arguments for non-Read tools", () => {
      const body = {
        tools: [
          {
            type: "function",
            function: {
              name: "Bash",
              description: "",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "toolu_4",
                type: "function",
                function: { name: "Bash", arguments: JSON.stringify({ command: "ls", pages: "" }) },
              },
            ],
          },
        ],
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
      const toolUse = result.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((b) => b?.type === "tool_use");

      expect(toolUse.input.pages).toBe("");
      expect(toolUse.input.command).toBe("ls");
    });

    it("sanitizes structured tool_use blocks in assistant history (not just tool_calls)", () => {
      const body = {
        tools: [readTool],
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_5",
                name: "Read",
                input: { file_path: "/etc/passwd", pages: "   " },
              },
            ],
          },
        ],
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);
      const toolUse = result.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((b) => b?.type === "tool_use");

      expect(toolUse.input).toEqual({ file_path: "/etc/passwd" });
    });
  });
});
