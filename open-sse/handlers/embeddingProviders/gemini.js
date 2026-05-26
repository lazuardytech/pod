// Google Gemini embeddings — embedContent / batchEmbedContents
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function modelPath(model) {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export default {
  buildUrl: (model, creds, { input } = {}) => {
    const apiKey = creds.apiKey || creds.accessToken;
    const path = modelPath(model);
    const op = Array.isArray(input) ? "batchEmbedContents" : "embedContent";
    return `${BASE}/${path}:${op}?key=${encodeURIComponent(apiKey)}`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (model, { input, dimensions } = {}) => {
    const m = modelPath(model);
    let outputDimensionality;
    if (dimensions != null && dimensions !== "") {
      const dim = Number(dimensions);
      if (Number.isFinite(dim) && dim > 0) outputDimensionality = dim;
    }
    if (Array.isArray(input)) {
      return {
        requests: input.map((text) => ({
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
  normalize: (responseBody, model) => {
    if (responseBody.object === "list" && Array.isArray(responseBody.data)) return responseBody;
    let items = [];
    if (Array.isArray(responseBody.embeddings)) {
      items = responseBody.embeddings.map((emb, idx) => ({
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
