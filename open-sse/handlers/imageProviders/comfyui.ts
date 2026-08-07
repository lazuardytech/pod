// ComfyUI — local, noAuth (placeholder; full graph workflow not implemented)
import type { ImageRequestBody } from "./_base.js";

export default {
  noAuth: true,
  buildUrl: () => "http://localhost:8188",
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model: string, body: ImageRequestBody) => ({ prompt: body.prompt }),
  normalize: (responseBody: unknown) => responseBody,
};
