// Codex (ChatGPT Plus/Pro) image generation via Responses API + SSE
import { randomUUID } from "node:crypto";
import {
  type ImageParseContext,
  type ImageRequestBody,
  type ProviderCredentials,
  nowSec,
} from "./_base.ts";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_USER_AGENT = "codex-imagen/0.2.6";
const CODEX_VERSION = "0.129.0";
const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_MODEL_SUFFIX = "-image";
const CODEX_REF_DETAIL = "high";

type CodexContent =
  | { type: "input_text"; text: string | undefined }
  | { type: "input_image"; image_url: string; detail: string };

type CodexCallbacks = {
  onPartialImage?: (info: { b64_json: string; index?: number }) => void;
  onProgress?: (info: { stage: string; bytesReceived: number }) => void;
};

type CodexSseData = {
  item?: { result?: string; type?: string };
  partial_image_b64?: string;
  partial_image_index?: number;
};

function decodeAccountId(idToken: string | undefined) {
  try {
    const parts = String(idToken || "").split(".");
    if (parts.length !== 3) return null;
    const b64 = (parts[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (b64.length % 4)) % 4;
    const payload = JSON.parse(Buffer.from(b64 + "=".repeat(pad), "base64").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || null;
  } catch {
    return null;
  }
}

function stripImageSuffix(model: string) {
  return model.endsWith(CODEX_MODEL_SUFFIX) ? model.slice(0, -CODEX_MODEL_SUFFIX.length) : model;
}

function toDataUrl(input: unknown) {
  if (!input || typeof input !== "string") return null;
  if (/^data:image\//i.test(input) || /^https?:\/\//i.test(input)) return input;
  return `data:image/png;base64,${input}`;
}

function buildContent(
  prompt: string | undefined,
  refs: string[],
  detail: string = CODEX_REF_DETAIL,
) {
  const content: CodexContent[] = [];
  refs.forEach((url, index) => {
    content.push({ type: "input_text", text: `<image name=image${index + 1}>` });
    content.push({ type: "input_image", image_url: url, detail });
    content.push({ type: "input_text", text: "</image>" });
  });
  content.push({ type: "input_text", text: prompt });
  return content;
}

// Parse Codex SSE stream → final base64 image. Optional callbacks for client streaming.
async function parseStream(
  response: Response,
  log: ImageParseContext["log"],
  callbacks: CodexCallbacks = {},
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64: string | null = null;
  let lastEvent: string | null = null;
  let bytesReceived = 0;
  let lastProgressLogMs = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesReceived += value?.byteLength || 0;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard SSE buffer parsing pattern
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);

      const lines = block.split("\n");
      let eventName = null;
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (!eventName) continue;
      if (eventName !== lastEvent) {
        log?.info?.("IMAGE", `codex progress: ${eventName}`);
        lastEvent = eventName;
      }

      const now = Date.now();
      if (callbacks.onProgress && now - lastProgressLogMs > 200) {
        lastProgressLogMs = now;
        callbacks.onProgress({ stage: eventName, bytesReceived });
      }

      if (eventName === "response.image_generation_call.partial_image" && dataStr) {
        try {
          const data = JSON.parse(dataStr) as CodexSseData;
          if (callbacks.onPartialImage && data?.partial_image_b64) {
            callbacks.onPartialImage({
              b64_json: data.partial_image_b64,
              index: data.partial_image_index,
            });
          }
        } catch {}
      }

      if (eventName === "response.output_item.done" && dataStr) {
        try {
          const data = JSON.parse(dataStr) as CodexSseData;
          const item = data?.item;
          if (item?.type === "image_generation_call" && item.result) {
            imageB64 = item.result;
          }
        } catch {}
      }
    }
  }
  return imageB64;
}

// SSE Response that pipes codex progress + partial + done events to client
function buildSseResponse(
  providerResponse: Response,
  log: ImageParseContext["log"],
  onSuccess: ImageParseContext["onRequestSuccess"],
) {
  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController<Uint8Array>) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const b64 = await parseStream(providerResponse, log, {
          onProgress: (info) => send("progress", info),
          onPartialImage: (info) => send("partial_image", info),
        });
        if (!b64) {
          send("error", {
            message:
              "Codex did not return an image. Account may not be entitled (Plus/Pro required).",
          });
        } else {
          if (onSuccess) await onSuccess();
          send("done", { created: nowSec(), data: [{ b64_json: b64 }] });
        }
      } catch (err: unknown) {
        send("error", { message: err instanceof Error ? err.message : "Stream failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  stream: true,
  buildUrl: () => CODEX_RESPONSES_URL,
  buildHeaders: (creds: ProviderCredentials) => {
    const accountId =
      creds?.providerSpecificData?.chatgptAccountId || decodeAccountId(creds?.idToken);
    return {
      accept: "text/event-stream, application/json",
      authorization: `Bearer ${creds?.accessToken || ""}`,
      "chatgpt-account-id": String(accountId || ""),
      "content-type": "application/json",
      originator: CODEX_ORIGINATOR,
      session_id: randomUUID(),
      "user-agent": CODEX_USER_AGENT,
      version: CODEX_VERSION,
      "x-client-request-id": randomUUID(),
    };
  },
  buildBody: (model: string, body: ImageRequestBody) => {
    const refs: string[] = [];
    if (Array.isArray(body.images))
      body.images.forEach((i) => {
        const u = toDataUrl(i);
        if (u) refs.push(u);
      });
    const single = toDataUrl(body.image);
    if (single) refs.push(single);
    const detail = body.image_detail || CODEX_REF_DETAIL;
    const imgTool: Record<string, unknown> = {
      type: "image_generation",
      output_format: (body.output_format || "png").toLowerCase(),
    };
    if (body.size && body.size !== "") imgTool.size = body.size;
    if (body.quality && body.quality !== "") imgTool.quality = body.quality;
    if (body.background && body.background !== "") imgTool.background = body.background;
    return {
      model: stripImageSuffix(model),
      instructions: "",
      input: [{ type: "message", role: "user", content: buildContent(body.prompt, refs, detail) }],
      tools: [imgTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
      prompt_cache_key: randomUUID(),
      stream: true,
      store: false,
      reasoning: null,
    };
  },
  // Custom: codex parses SSE → either pipe to client or collect b64
  async parseResponse(
    response: Response,
    { log, streamToClient, onRequestSuccess }: ImageParseContext,
  ) {
    if (streamToClient) {
      return { sseResponse: buildSseResponse(response, log, onRequestSuccess) };
    }
    const b64 = await parseStream(response, log);
    if (!b64) {
      throw new Error(
        "Codex did not return an image. Account may not be entitled (Plus/Pro required).",
      );
    }
    return { created: nowSec(), data: [{ b64_json: b64 }] };
  },
  normalize: (responseBody: unknown) => responseBody,
};
