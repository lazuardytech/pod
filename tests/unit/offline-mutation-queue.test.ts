import { describe, expect, it } from "vitest";
import {
  enqueueOfflineMutation,
  isAllowedOfflineMutation,
} from "@/shared/services/offlineMutationQueue";

describe("offline mutation allowlist", () => {
  it("allows PATCH /api/settings and PUT /api/providers/:id only", () => {
    expect(isAllowedOfflineMutation("PATCH", "/api/settings")).toBe(true);
    expect(isAllowedOfflineMutation("PUT", "/api/providers/abc")).toBe(true);
    expect(isAllowedOfflineMutation("PUT", "https://pod.example/api/providers/abc")).toBe(true);
    expect(isAllowedOfflineMutation("POST", "/api/settings")).toBe(false);
    expect(isAllowedOfflineMutation("PATCH", "/api/keys")).toBe(false);
    expect(isAllowedOfflineMutation("PUT", "/api/providers/abc/rename")).toBe(false);
  });

  it("rejects enqueue of non-allowlisted mutations without IDB", async () => {
    const result = await enqueueOfflineMutation({ url: "/api/keys", method: "POST" });
    expect(result).toEqual({ ok: false, reason: "not_allowed" });
  });
});
