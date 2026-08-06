// ComfyUI — local, noAuth (placeholder; full graph workflow not implemented)
export default {
  noAuth: true,
  buildUrl: () => "http://localhost:8188",
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model: any, body: any) => ({ prompt: body.prompt }),
  normalize: (responseBody: any) => responseBody,
};
