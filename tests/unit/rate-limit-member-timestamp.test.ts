import { describe, expect, it } from "vitest";
import { parseMemberTimestamp } from "@/lib/rateLimit/redis";

describe("parseMemberTimestamp — Redis RPM member format", () => {
  it("parses the timestamp prefix of `${ts}:${uuid}` members", () => {
    expect(parseMemberTimestamp("1790000000123:a1b2c3d4", 999)).toBe(1790000000123);
  });

  it("falls back when the member has no timestamp prefix", () => {
    expect(parseMemberTimestamp("oops", 12345)).toBe(12345);
  });

  it("falls back on a NaN timestamp segment", () => {
    expect(parseMemberTimestamp("notanumber:a1b2c3d4", 777)).toBe(777);
  });
});
