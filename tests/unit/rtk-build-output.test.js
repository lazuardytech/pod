/**
 * Unit tests for open-sse/rtk/filters/buildOutput.js + autodetect routing.
 */

import { describe, expect, it } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { buildOutput } from "../../open-sse/rtk/filters/buildOutput.js";

describe("buildOutput filter", () => {
  it("collapses npm WARN/notice into a counted bucket and keeps the install summary", () => {
    const log = [
      "> pod@0.0.44 build",
      "> next build",
      "npm WARN deprecated foo@1: use bar",
      "npm WARN deprecated baz@2: gone",
      "npm WARN deprecated qux@3: please migrate",
      "npm notice created lockfile",
      "npm notice updated 3 packages",
      "added 5 packages, removed 2 packages, audited 250 packages in 3s",
      "0 vulnerabilities",
    ].join("\n");

    const out = buildOutput(log);
    expect(out).toContain("> pod@0.0.44 build");
    expect(out).toContain("(3 deprecated package warnings collapsed)");
    expect(out).toContain("(2 npm warn/notice lines collapsed)");
    expect(out).toContain("added 5 packages, removed 2 packages, audited 250 packages in 3s");
    expect(out).toContain("0 vulnerabilities");
  });

  it("preserves npm err! lines verbatim", () => {
    const log = [
      "npm WARN deprecated foo",
      "npm ERR! code ELIFECYCLE",
      "npm ERR! errno 1",
      "npm ERR! pod@0.0.44 build: `next build`",
    ].join("\n");
    const out = buildOutput(log);
    expect(out).toContain("npm ERR! code ELIFECYCLE");
    expect(out).toContain("npm ERR! errno 1");
    expect(out).toContain("npm ERR! pod@0.0.44 build:");
  });

  it("collapses cargo Compiling runs to first + last with a counted gap", () => {
    const log = [
      "   Compiling proc-macro2 v1.0.86",
      "   Compiling unicode-ident v1.0.13",
      "   Compiling syn v2.0.85",
      "   Compiling serde v1.0.213",
      "   Compiling tokio v1.41.0",
      "   Compiling pod-cli v0.1.0 (/work/pod)",
      "    Finished `release` profile [optimized] target(s) in 42.31s",
    ].join("\n");
    const out = buildOutput(log);
    const lines = out.split("\n");

    expect(lines[0]).toMatch(/Compiling proc-macro2/);
    expect(out).toContain("(4 compile lines)");
    expect(out).toContain("Compiling pod-cli");
    expect(out).toContain("Finished `release`");
  });

  it("keeps cargo errors verbatim and never buckets them", () => {
    const log = [
      "   Compiling foo v0.1.0",
      "   Compiling bar v0.1.0",
      "error[E0277]: the trait bound `T: Send` is not satisfied",
      "  --> src/lib.rs:10:5",
      "warning: unused import `std::collections::HashMap`",
      "  --> src/util.rs:1:5",
    ].join("\n");
    const out = buildOutput(log);
    expect(out).toContain("error[E0277]: the trait bound `T: Send` is not satisfied");
    expect(out).toContain("warning: unused import `std::collections::HashMap`");
    expect(out).toContain("--> src/lib.rs:10:5");
  });

  it("caps compiler warnings at WARNING_KEEP_MAX", () => {
    const lines = ["   Compiling foo v0.1.0"];
    for (let i = 0; i < 15; i++) {
      lines.push(`warning: unused variable: \`x_${i}\``);
    }
    const out = buildOutput(lines.join("\n"));
    const warningCount = (out.match(/^warning:/gm) || []).length;
    expect(warningCount).toBe(10);
    expect(out).toContain("additional warnings truncated, threshold=10");
  });

  it("collapses exact consecutive duplicate lines", () => {
    const log = ["build complete", "build complete", "build complete", "tests passed"].join("\n");
    const out = buildOutput(log);
    expect(out).toContain("build complete");
    expect(out).toContain("(2 duplicate lines)");
    expect(out).toContain("tests passed");
  });

  it("returns input unchanged when no patterns match", () => {
    const log = "hello\nworld\nlorem ipsum";
    expect(buildOutput(log)).toBe(log);
  });

  it("filterName is build-output", () => {
    expect(buildOutput.filterName).toBe("build-output");
  });
});

describe("autoDetectFilter routes build logs to buildOutput", () => {
  it("npm install log → buildOutput", () => {
    const log = [
      "> pod@0.0.44 install",
      "> node-gyp",
      "npm WARN deprecated foo@1.0",
      "added 250 packages in 12s",
    ].join("\n");
    const f = autoDetectFilter(log);
    expect(f).toBe(buildOutput);
  });

  it("cargo build log → buildOutput", () => {
    const log = [
      "   Compiling proc-macro2 v1.0.86",
      "   Compiling unicode-ident v1.0.13",
      "    Finished `release` profile [optimized] target(s) in 42.31s",
    ].join("\n");
    const f = autoDetectFilter(log);
    expect(f).toBe(buildOutput);
  });

  it("yarn output → buildOutput", () => {
    const log = ["yarn install v1.22.22", "info Resolving packages...", "Done in 4.12s."].join(
      "\n",
    );
    const f = autoDetectFilter(log);
    expect(f).toBe(buildOutput);
  });

  it("plain git diff still routes to gitDiff (build patterns don't false-positive)", async () => {
    const { gitDiff } = await import("../../open-sse/rtk/filters/gitDiff.js");
    const log = ["diff --git a/foo.js b/foo.js", "@@ -1,3 +1,3 @@", "-old", "+new", "context"].join(
      "\n",
    );
    const f = autoDetectFilter(log);
    expect(f).toBe(gitDiff);
  });
});
