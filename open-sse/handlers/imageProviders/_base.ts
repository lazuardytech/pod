// Shared helpers for image provider adapters

export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 120000;

export type JsonObject = Record<string, unknown>;

export type ProviderCredentials = {
  apiKey?: string;
  accessToken?: string;
  idToken?: string;
  providerSpecificData?: JsonObject;
} | null;

export type ImageRequestBody = JsonObject & {
  background?: string;
  height?: number | string;
  image?: string | number[];
  image_detail?: string;
  images?: unknown[];
  mask?: string | number[];
  maskImage?: string | number[];
  mask_image?: string | number[];
  n?: number;
  negative_prompt?: unknown;
  num_steps?: unknown;
  output_format?: string;
  prompt?: string;
  quality?: string;
  response_format?: string;
  seed?: unknown;
  size?: string;
  steps?: unknown;
  strength?: unknown;
  style?: string;
  width?: number | string;
};

export type ImageProviderHeaders = Record<string, string>;

export type PollingParseContext = {
  headers: HeadersInit | ImageProviderHeaders;
};

export type ImageParseContext = PollingParseContext & {
  body?: ImageRequestBody;
  log?: { debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
  model?: string;
  onRequestSuccess?: () => Promise<void> | void;
  requestBody?: unknown;
  streamToClient?: boolean;
  url?: string;
};

export type ImageResponseBody = JsonObject & {
  created?: number;
  data?: unknown[];
};

export type ImageProviderAdapter = {
  async?: boolean;
  buildBody: (model: string, body: ImageRequestBody) => Promise<unknown> | unknown;
  buildHeaders: (credentials: ProviderCredentials, requestBody?: unknown, model?: string, body?: ImageRequestBody) => HeadersInit | ImageProviderHeaders;
  buildUrl: (model: string, credentials: ProviderCredentials) => string | undefined;
  noAuth?: boolean;
  normalize: (responseBody: unknown, prompt?: string) => unknown;
  parseResponse?: (response: Response, context: ImageParseContext) => Promise<unknown> | unknown;
  stream?: boolean;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Map OpenAI size to provider-specific aspect ratio
export function sizeToAspectRatio(size: string | undefined) {
  if (!size || typeof size !== "string") return "1:1";
  const map: Record<string, string> = {
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "1024x1536": "2:3",
    "1536x1024": "3:2",
  };
  return map[size] || "1:1";
}

// Fetch URL → base64 (for providers returning image URLs)
export async function urlToBase64(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}
