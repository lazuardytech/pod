import {
  type ImageProviderHeaders,
  type ImageRequestBody,
  type ImageResponseBody,
  type JsonObject,
  type ProviderCredentials,
  nowSec,
  urlToBase64,
} from "./_base.js";

const BASE_URL = "https://api.cloudflare.com/client/v4/accounts";

const MULTIPART_MODELS = new Set([
  "@cf/black-forest-labs/flux-2-dev",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-klein-9b",
]);

const OPTIONAL_FIELDS = ["negative_prompt", "guidance", "seed", "num_steps", "steps", "strength"];

type ImageInputData = { b64: string; bytes: number[] | string };

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function sizeToDimensions(size: string | undefined) {
  const match = /^(\d+)x(\d+)$/.exec(String(size || ""));
  if (!match) return {};
  return {
    width: Number(match[1] || 0),
    height: Number(match[2] || 0),
  };
}

function getDimensions(body: ImageRequestBody) {
  return {
    ...sizeToDimensions(body.size),
    ...(Number.isFinite(Number(body.width)) ? { width: Number(body.width) } : {}),
    ...(Number.isFinite(Number(body.height)) ? { height: Number(body.height) } : {}),
  };
}

async function resolveImageInput(value: unknown): Promise<ImageInputData | null> {
  if (Array.isArray(value)) {
    return { bytes: value, b64: Buffer.from(value).toString("base64") };
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    const b64 = await urlToBase64(trimmed);
    return { bytes: base64ToBytes(b64), b64 };
  }
  const match = /^data:image\/[^;]+;base64,(.+)$/i.exec(trimmed);
  const b64 = match ? match[1] || "" : trimmed;
  return { bytes: base64ToBytes(b64), b64 };
}

function base64ToBytes(value: string) {
  try {
    return Array.from(Buffer.from(value, "base64"));
  } catch {
    return value;
  }
}

function addOptionalFields<TTarget>(
  target: TTarget,
  body: ImageRequestBody,
  append: (target: TTarget, key: string, value: unknown) => void,
) {
  for (const key of OPTIONAL_FIELDS) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    append(target, key, value);
  }
}

async function buildJsonBody(body: ImageRequestBody) {
  const req: JsonObject = { prompt: body.prompt, ...getDimensions(body) };

  addOptionalFields(req, body, (target, key, value) => {
    target[key] = value;
  });

  const imageData = await resolveImageInput(body.image);
  if (imageData) {
    req.image_b64 = imageData.b64;
    req.image = imageData.bytes;
  }

  const maskData = await resolveImageInput(body.mask_image || body.maskImage || body.mask);
  if (maskData) {
    req.mask_b64 = maskData.b64;
    req.mask = maskData.bytes;
    req.mask_image = maskData.bytes;
  }

  return req;
}

function buildMultipartBody(body: ImageRequestBody) {
  const form = new FormData();
  form.append("prompt", body.prompt as string);

  const dimensions = getDimensions(body);
  for (const [key, value] of Object.entries(dimensions)) {
    form.append(key, String(value));
  }

  addOptionalFields(form, body, (target, key, value) => {
    target.append(key, String(value));
  });

  return form;
}

function imageItemFromString(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (/^data:image\/[^;]+;base64,/i.test(value)) {
    return { b64_json: value.replace(/^data:image\/[^;]+;base64,/i, "") };
  }
  if (/^https?:\/\//i.test(value)) return { url: value };
  return { b64_json: value };
}

function normalizeCloudflareResponse(responseBody: unknown): ImageResponseBody {
  const responseRecord = asRecord(responseBody);
  if (responseRecord.created && Array.isArray(responseRecord.data)) return responseRecord;

  const result = responseRecord.result ?? responseBody;
  const resultRecord = asRecord(result);
  const queuedResponse = Array.isArray(resultRecord.responses)
    ? resultRecord.responses.find((item) => asRecord(item).success !== false)
    : null;
  if (queuedResponse) return normalizeCloudflareResponse(asRecord(queuedResponse).result);

  const firstDataItem = Array.isArray(resultRecord.data) ? asRecord(resultRecord.data[0]) : {};
  const image =
    (typeof result === "string" ? result : null) ||
    resultRecord.image ||
    firstDataItem.b64_json ||
    firstDataItem.url;

  const item = imageItemFromString(image);
  return {
    created: nowSec(),
    data: item ? [item] : [],
  };
}

export default {
  buildUrl: (model: string, creds: ProviderCredentials) => {
    const accountId = creds?.providerSpecificData?.accountId;
    if (!accountId) throw new Error("cloudflare-ai requires accountId in providerSpecificData");
    return `${BASE_URL}/${accountId}/ai/run/${model}`;
  },

  buildHeaders: (creds: ProviderCredentials, requestBody: unknown) => {
    const headers: ImageProviderHeaders = {};
    const isMultipart = typeof FormData !== "undefined" && requestBody instanceof FormData;
    if (!isMultipart) {
      headers["Content-Type"] = "application/json";
    }
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  },

  buildBody: async (model: string, body: ImageRequestBody) =>
    MULTIPART_MODELS.has(model) ? buildMultipartBody(body) : await buildJsonBody(body),

  async parseResponse(response: Response) {
    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (contentType.startsWith("image/")) {
      const buf = await response.arrayBuffer();
      return {
        created: nowSec(),
        data: [{ b64_json: Buffer.from(buf).toString("base64") }],
      };
    }

    const json = await response.json();
    return normalizeCloudflareResponse(json);
  },

  normalize: normalizeCloudflareResponse,
};
