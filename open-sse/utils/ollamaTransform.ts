type PendingToolCall = {
  id?: string;
  function: { name: string; arguments: string };
};

// Transform OpenAI SSE stream to Ollama JSON lines format
export function transformToOllama(response: Response, model: string) {
  let buffer = "";
  let pendingToolCalls: Record<string, PendingToolCall> = {};

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      const text = new TextDecoder().decode(chunk);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();

        if (data === "[DONE]") {
          const ollamaEnd =
            JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true }) +
            "\n";
          controller.enqueue(new TextEncoder().encode(ollamaEnd));
          return;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number | string;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }>;
          };
          const delta = parsed.choices?.[0]?.delta || {};
          const content = delta.content || "";
          const toolCalls = delta.tool_calls;

          if (toolCalls) {
            for (const tc of toolCalls) {
              const idx = String(tc.index);
              if (!pendingToolCalls[idx]) {
                pendingToolCalls[idx] = { id: tc.id, function: { name: "", arguments: "" } };
              }
              const slot = pendingToolCalls[idx]!;
              if (tc.function?.name) slot.function.name += tc.function.name;
              if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
            }
          }

          if (content) {
            const ollama =
              JSON.stringify({ model, message: { role: "assistant", content }, done: false }) +
              "\n";
            controller.enqueue(new TextEncoder().encode(ollama));
          }

          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === "tool_calls" || finishReason === "stop") {
            const toolCallsArr = Object.values(pendingToolCalls);
            if (toolCallsArr.length > 0) {
              const formattedCalls = toolCallsArr.map((tc: PendingToolCall) => ({
                function: {
                  name: tc.function.name,
                  arguments: (() => {
                    try {
                      return JSON.parse(tc.function.arguments || "{}");
                    } catch {
                      return {};
                    }
                  })(),
                },
              }));
              const ollama =
                JSON.stringify({
                  model,
                  message: { role: "assistant", content: "", tool_calls: formattedCalls },
                  done: true,
                }) + "\n";
              controller.enqueue(new TextEncoder().encode(ollama));
              pendingToolCalls = {};
            } else if (finishReason === "stop") {
              const ollamaEnd =
                JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true }) +
                "\n";
              controller.enqueue(new TextEncoder().encode(ollamaEnd));
            }
          }
        } catch {
          // Malformed upstream chunks are ignored; later SSE frames may still be valid.
        }
      }
    },
    flush(controller: TransformStreamDefaultController<Uint8Array>) {
      const ollamaEnd =
        JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true }) + "\n";
      controller.enqueue(new TextEncoder().encode(ollamaEnd));
    },
  });

  if (!response.body) {
    return new Response("", {
      status: response.status,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }
  return new Response(response.body.pipeThrough(transform), {
    headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" },
  });
}
