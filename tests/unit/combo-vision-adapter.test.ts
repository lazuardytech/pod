import { describe, expect, it } from "vitest";
import { augmentModelsWithCapacityAdapter } from "../../open-sse/services/capacityAdapter.ts";
import {
  detectRequiredCapabilities,
  reorderByCapabilities,
} from "../../open-sse/services/combo.ts";

const DEEPSEEK = "ds/deepseek-chat";
const CLAUDE = "anthropic/claude-sonnet-4";

describe("combo vision adapter", () => {
  it("reorders a DeepSeek-first combo onto a vision model for the current image turn", () => {
    const models = [DEEPSEEK, CLAUDE];
    const body = {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }],
        },
      ],
    };
    const required = detectRequiredCapabilities(body);
    expect(required.has("vision")).toBe(true);
    expect(reorderByCapabilities(models, required)[0]).toBe(CLAUDE);
  });

  it("ignores images on prior turns so old screenshots do not pin routing", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://example.com/old.png" } }],
        },
        { role: "assistant", content: "seen" },
        { role: "user", content: "text only now" },
      ],
    };
    expect(detectRequiredCapabilities(body).has("vision")).toBe(false);
  });

  it("does not rewrite models when the Vision pool is empty", () => {
    const orig = [DEEPSEEK];
    const next = augmentModelsWithCapacityAdapter(orig, new Set(["vision"]), {
      capacityAdapter: { vision: { enabled: true, roundRobin: false, models: [] } },
    });
    expect(next).toEqual(orig);
  });

  it("prepends a capable pool model when no original member can see", () => {
    const next = augmentModelsWithCapacityAdapter([DEEPSEEK], new Set(["vision"]), {
      capacityAdapter: {
        vision: { enabled: true, roundRobin: false, models: [CLAUDE] },
      },
    });
    expect(next).toEqual([CLAUDE, DEEPSEEK]);
  });

  it("leaves a combo that already has a vision member untouched by the pool", () => {
    const orig = [CLAUDE, DEEPSEEK];
    const next = augmentModelsWithCapacityAdapter(orig, new Set(["vision"]), {
      capacityAdapter: {
        vision: { enabled: true, roundRobin: false, models: ["oc/mimo-v2.5-free"] },
      },
    });
    expect(next).toEqual(orig);
  });
});
