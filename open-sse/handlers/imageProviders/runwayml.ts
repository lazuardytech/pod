// Runway ML — async submit + /tasks/{id} polling
import { nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, sizeToAspectRatio, sleep } from "./_base.js";

const BASE_URL = "https://api.dev.runwayml.com/v1";

export default {
  async: true,
  buildUrl: (model: any) => {
    // Image models (gen4_image*) → text_to_image; video models → image_to_video
    return `${BASE_URL}/${model.includes("image") ? "text_to_image" : "image_to_video"}`;
  },
  buildHeaders: (creds: any) => {
    const key = creds?.apiKey || creds?.accessToken;
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "X-Runway-Version": "2024-11-06",
    };
  },
  buildBody: (model: any, body: any) => {
    const isVideo = !model.includes("image");
    const ratio = sizeToAspectRatio(body.size);
    if (isVideo) {
      return {
        promptText: body.prompt,
        model,
        ratio,
        duration: 5,
        ...(body.image ? { promptImage: body.image } : {}),
      };
    }
    return {
      promptText: body.prompt,
      model,
      ratio,
      ...(body.image ? { referenceImages: [{ uri: body.image }] } : {}),
    };
  },
  async parseResponse(response: any, { headers }: any) {
    const { id } = await response.json();
    if (!id) throw new Error("Runway: no task id returned");
    const taskUrl = `${BASE_URL}/tasks/${id}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(taskUrl, { headers });
      if (!r.ok) throw new Error(`Runway status ${r.status}`);
      const s = await r.json();
      if (s.status === "SUCCEEDED") return s;
      if (s.status === "FAILED" || s.status === "CANCELLED")
        throw new Error(s.failure || "Runway task failed");
    }
    throw new Error("Runway polling timeout");
  },
  normalize: (responseBody: any) => {
    const outputs = Array.isArray(responseBody.output) ? responseBody.output : [];
    return { created: nowSec(), data: outputs.map((url: any) => ({ url })) };
  },
};
