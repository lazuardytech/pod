// Google Gemini embeddings — embedContent / batchEmbedContents
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function modelPath(model: any) {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export default {
  buildUrl: (model: any, creds: any, { input }: any = {}) => {
    const apiKey = creds.apiKey || creds.accessToken;
    const path = modelPath(model);
    const op = Array.isArray(input) ? "batchEmbedContents" : "embedContent";
    return `${BASE}/${path}:${op}?key=${encodeURIComponent(apiKey)}`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (model: any, { input, dimensions }: any = {}) => {
    const m = modelPath(model);
    let outputDimensionality: any;
    if (dimensions != null && dimensions !== "") {
      const dim = Number(dimensions);
      if (Number.isFinite(dim) && dim > 0) outputDimensionality = dim;
    }
    if (Array.isArray(input)) {
      return {
        requests: input.map((text: any) => ({
          model: m,
          content: { parts: [{ text: String(text) }] },
          ...(outputDimensionality ? { outputDimensionality } : {}),
        })),
      };
    }
    return {
      model: m,
      content: { parts: [{ text: String(input) }] },
      ...(outputDimensionality ? { outputDimensionality } : {}),
    };
  },
  normalize: (responseBody: any, model: any) => {
    if (responseBody.object === "list" && Array.isArray(responseBody.data)) return responseBody;
    let items = [];
    if (Array.isArray(responseBody.embeddings)) {
      items = responseBody.embeddings.map((emb: any, idx: any) => ({
        object: "embedding",
        index: idx,
        embedding: emb.values || [],
      }));
    } else if (responseBody.embedding?.values) {
      items = [{ object: "embedding", index: 0, embedding: responseBody.embedding.values }];
    }
    return {
      object: "list",
      data: items,
      model,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  },
};
