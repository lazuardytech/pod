import { Buffer } from "node:buffer";
import { AI_PROVIDERS } from "../../src/shared/constants/providers";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { createErrorResult, type ErrorResult } from "../utils/error.js";

export type SttResult = { success: true; response: Response } | ErrorResult;

export interface SttCoreParams {
  provider: string;
  model: string;
  formData: FormData;
  credentials?: Record<string, unknown> | null;
  translate?: boolean;
}

type SttConfig = {
  authHeader?: "bearer" | "token" | "x-api-key" | "key";
  authType?: string;
  baseUrl: string;
  format?: string;
};

type UploadFile = Blob & { name?: string; type?: string };
type TextPart = { text?: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Build auth headers from sttConfig + token
function buildAuthHeaders(cfg: SttConfig, token: unknown): Record<string, string> {
  if (!token) return {};
  const value = String(token);
  switch (cfg.authHeader) {
    case "bearer":
      return { Authorization: `Bearer ${value}` };
    case "token":
      return { Authorization: `Token ${value}` };
    case "x-api-key":
      return { "x-api-key": value };
    case "key":
      return { Authorization: `Key ${value}` };
    default:
      return { Authorization: `Bearer ${value}` };
  }
}

// Map browser file MIME / ext → audio MIME for binary formats (deepgram/HF)
function resolveAudioContentType(file: UploadFile) {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("audio/")) return t;
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    mp4: "audio/mp4",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
    aac: "audio/aac",
    opus: "audio/opus",
  };
  return map[ext] || "application/octet-stream";
}

async function upstreamError(res: Response): Promise<SttResult> {
  let txt = "";
  try {
    txt = await res.text();
  } catch {}
  let msg = txt || `Upstream error (${res.status})`;
  try {
    const j = JSON.parse(txt);
    msg = j?.error?.message || j?.error || j?.message || msg;
  } catch {}
  return createErrorResult(
    res.status,
    typeof msg === "string" ? msg : JSON.stringify(msg),
    undefined,
  );
}

// Deepgram: raw binary POST + model query param
async function transcribeDeepgram(
  cfg: SttConfig,
  file: UploadFile,
  model: string,
  token: unknown,
  formData: FormData,
): Promise<SttResult> {
  const url = new URL(cfg.baseUrl);
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  const lang = formData.get("language");
  if (typeof lang === "string" && lang.trim()) url.searchParams.set("language", lang.trim());
  else url.searchParams.set("detect_language", "true");

  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(cfg, token),
      "Content-Type": resolveAudioContentType(file),
    },
    body: buf,
  });
  if (!res.ok) return upstreamError(res);
  const data = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return jsonResponse({ text });
}

// AssemblyAI: upload → submit → poll (max 120s)
async function transcribeAssemblyAI(
  cfg: SttConfig,
  file: UploadFile,
  model: string,
  token: unknown,
): Promise<SttResult> {
  const auth = buildAuthHeaders(cfg, token);
  const buf = await file.arrayBuffer();
  const up = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/octet-stream" },
    body: buf,
  });
  if (!up.ok) return upstreamError(up);
  const { upload_url } = (await up.json()) as { upload_url?: string };

  const sub = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_models: [model],
      language_detection: true,
    }),
  });
  if (!sub.ok) return upstreamError(sub);
  const { id } = (await sub.json()) as { id?: string };

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    const poll = await fetch(`${cfg.baseUrl}/${id}`, { headers: auth });
    if (!poll.ok) continue;
    const r = (await poll.json()) as { error?: string; status?: string; text?: string };
    if (r.status === "completed") return jsonResponse({ text: r.text || "" });
    if (r.status === "error")
      return createErrorResult(500, r.error || "AssemblyAI failed", undefined);
  }
  return createErrorResult(504, "AssemblyAI timeout after 120s", undefined);
}

// Nvidia NIM: multipart, normalize response
async function transcribeNvidia(
  cfg: SttConfig,
  file: UploadFile,
  model: string,
  token: unknown,
): Promise<SttResult> {
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("model", model);
  const res = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: buildAuthHeaders(cfg, token),
    body: fd,
  });
  if (!res.ok) return upstreamError(res);
  const data = (await res.json()) as { text?: string; transcript?: string };
  return jsonResponse({ text: data.text || data.transcript || "" });
}

// Gemini: generateContent with inline_data audio + transcription prompt
async function transcribeGemini(
  cfg: SttConfig,
  file: UploadFile,
  model: string,
  token: unknown,
  formData: FormData,
): Promise<SttResult> {
  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const mime = resolveAudioContentType(file);
  const lang = formData.get("language");
  const userPrompt = formData.get("prompt");
  let promptText =
    userPrompt && typeof userPrompt === "string" && userPrompt.trim()
      ? userPrompt.trim()
      : "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
  if (typeof lang === "string" && lang.trim()) promptText += ` Language: ${lang.trim()}.`;

  const url = `${cfg.baseUrl}/${model}:generateContent?key=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }] },
      ],
    }),
  });
  if (!res.ok) return upstreamError(res);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: TextPart[] } }[];
  };
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("") || "";
  return jsonResponse({ text });
}

// HuggingFace: POST raw binary to {baseUrl}/{model_id}
async function transcribeHuggingFace(
  cfg: SttConfig,
  file: UploadFile,
  model: string,
  token: unknown,
): Promise<SttResult> {
  if (model.includes("..") || model.includes("//"))
    return createErrorResult(400, "Invalid model ID", undefined);
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${model}`;
  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(cfg, token),
      "Content-Type": resolveAudioContentType(file),
    },
    body: buf,
  });
  if (!res.ok) return upstreamError(res);
  const data = (await res.json()) as { text?: string };
  return jsonResponse({ text: data.text || "" });
}

// Default: OpenAI/Groq/Whisper-compatible multipart
async function transcribeOpenAICompatible(
  cfg: SttConfig,
  file: UploadFile,
  model: string,
  token: unknown,
  formData: FormData,
  translate: boolean | undefined,
): Promise<SttResult> {
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("model", model);
  for (const k of ["prompt", "response_format", "temperature"]) {
    const v = formData.get(k);
    if (v !== null && v !== undefined && v !== "") fd.append(k, v);
  }
  if (!translate) {
    const lang = formData.get("language");
    if (lang !== null && lang !== undefined && lang !== "") fd.append("language", lang);
  }
  const res = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: buildAuthHeaders(cfg, token),
    body: fd,
  });
  if (!res.ok) return upstreamError(res);
  const ct = res.headers.get("content-type") || "application/json";
  const txt = await res.text();
  return {
    success: true,
    response: new Response(txt, {
      status: 200,
      headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*" },
    }),
  };
}

function jsonResponse(obj: unknown): SttResult {
  return {
    success: true,
    response: new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

/**
 * STT core handler — dispatch by sttConfig.format.
 * @returns {Promise<{success, response, status?, error?}>}
 */
export async function handleSttCore({
  provider,
  model,
  formData,
  credentials,
  translate,
}: SttCoreParams): Promise<SttResult> {
  const file = formData.get("file") as UploadFile | null;
  if (!file)
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: file", undefined);

  const cfg = AI_PROVIDERS[provider]?.sttConfig as SttConfig | undefined;
  if (!cfg)
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support STT`,
      undefined,
    );

  const token = cfg.authType === "none" ? null : credentials?.apiKey || credentials?.accessToken;
  if (cfg.authType !== "none" && !token) {
    return createErrorResult(
      HTTP_STATUS.UNAUTHORIZED,
      `No credentials for STT provider: ${provider}`,
      undefined,
    );
  }

  try {
    switch (cfg.format) {
      case "deepgram":
        return await transcribeDeepgram(cfg, file, model, token, formData);
      case "assemblyai":
        return await transcribeAssemblyAI(cfg, file, model, token);
      case "nvidia-asr":
        return await transcribeNvidia(cfg, file, model, token);
      case "huggingface-asr":
        return await transcribeHuggingFace(cfg, file, model, token);
      case "gemini-stt":
        return await transcribeGemini(cfg, file, model, token, formData);
      default:
        return await transcribeOpenAICompatible(cfg, file, model, token, formData, translate);
    }
  } catch (err: unknown) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errorMessage(err) || "STT request failed", undefined);
  }
}
