import { describe, expect, it } from "vitest";
import { validateFetchUrl } from "@/lib/validateUrl";

describe("validateFetchUrl", () => {
  it("blocks nip.io rebinding hosts", () => {
    const result = validateFetchUrl("https://demo.127.0.0.1.nip.io/path");
    expect(result.ok).toBe(false);
  });

  it("blocks sslip.io rebinding hosts", () => {
    const result = validateFetchUrl("https://foo.203-0-113-10.sslip.io/path");
    expect(result.ok).toBe(false);
  });

  it("blocks localhost-like suffixes", () => {
    const result = validateFetchUrl("https://service.localtest.me/path");
    expect(result.ok).toBe(false);
  });

  it("allows public https URLs", () => {
    const result = validateFetchUrl("https://example.com/health");
    expect(result.ok).toBe(true);
  });

  it("blocks https://0.0.0.0/", () => {
    const result = validateFetchUrl("https://0.0.0.0/");
    expect(result.ok).toBe(false);
  });

  it("blocks http://0.0.0.0:8080", () => {
    const result = validateFetchUrl("http://0.0.0.0:8080");
    expect(result.ok).toBe(false);
  });
});
