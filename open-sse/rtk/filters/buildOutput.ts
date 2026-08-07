// buildOutput — collapses npm/yarn/pnpm/cargo build-log noise while preserving
// errors and the final summary. Mirrors 9router's RTK buildOutput filter.
//
// Heuristics:
//   • npm/yarn/pnpm WARN/notice/deprecation lines collapse into a counted bucket
//   • cargo "Compiling foo vX.Y.Z" runs collapse to first/last + count
//   • "added/removed/changed/audited N packages" summary kept verbatim
//   • "N vulnerabilities" / audit summary kept verbatim
//   • errors (npm err, error[E…], rustc error, ts/eslint errors) kept verbatim
//   • compiler warnings kept but capped at WARNING_KEEP_MAX
//   • everything else passes through with consecutive-duplicate collapse

const WARNING_KEEP_MAX = 10;

const RE_NPM_WARN = /^npm\s+(WARN|warn|notice)\b/;
const RE_NPM_DEPRECATED = /^npm\s+(WARN|warn)\s+deprecated\b/i;
const RE_NPM_ERR = /^npm\s+(ERR|err)!?\b/i;
const RE_NPM_SUMMARY =
  /^(added|removed|changed|audited)\s+\d+\s+packages?(,\s+(added|removed|changed|audited)\s+\d+\s+packages?)*(\s+in\s+\S+)?$/i;
const RE_NPM_VULN = /^\d+\s+(vulnerabilit(y|ies)|moderate|high|critical|low|info)\b/i;
const RE_NPM_RUN = /^>\s+\S+@\S+\s+\S+/; // "> pkg@1.0.0 build"
const RE_YARN = /^(yarn|pnpm)\s+/;
const RE_YARN_INFO = /^(info|warning)\s+/;
const RE_CARGO_COMPILING = /^\s*(Compiling|Checking|Building|Finished|Downloading|Updating)\s+/;
const RE_CARGO_FRESH = /^\s*Fresh\s+/;
const RE_CARGO_ERROR = /^error(\[\w+\])?:/;
const RE_CARGO_WARNING = /^warning(\[\w+\])?:/;
const RE_TSC_ERROR = /^[^\s].*\.(ts|tsx|js|jsx|mjs|cjs):\d+:\d+\s*-\s*error\b/i;
const RE_ESLINT_ERROR = /^\s*\d+:\d+\s+error\b/;
const RE_GENERIC_ERROR = /^(Error|FAIL|FAILED|panic|Aborted)[\s:]/i;

export function buildOutput(input: unknown, _maxLines?: number) {
  if (!input || typeof input !== "string") return input;

  const lines = input.split("\n");
  const out = [];

  // Aggregator buckets
  let npmWarnCount = 0;
  let npmDeprecatedCount = 0;
  let cargoCompileCount = 0;
  let cargoCompileFirst: string | null = null;
  let cargoCompileLast: string | null = null;
  let warningCount = 0; // compiler warnings (cargo/rustc-style)
  let prev: string | null = null;
  let dupRun = 0;

  const flushNpmWarn = () => {
    if (npmWarnCount > 0) {
      out.push(`  ... (${npmWarnCount} npm warn/notice lines collapsed)`);
      npmWarnCount = 0;
    }
    if (npmDeprecatedCount > 0) {
      out.push(`  ... (${npmDeprecatedCount} deprecated package warnings collapsed)`);
      npmDeprecatedCount = 0;
    }
  };

  const flushCargoCompile = () => {
    if (cargoCompileCount === 0) return;
    if (cargoCompileFirst) out.push(cargoCompileFirst);
    if (cargoCompileCount > 2 && cargoCompileLast && cargoCompileLast !== cargoCompileFirst) {
      out.push(`  ... (${cargoCompileCount - 2} compile lines)`);
      out.push(cargoCompileLast);
    } else if (
      cargoCompileCount === 2 &&
      cargoCompileLast &&
      cargoCompileLast !== cargoCompileFirst
    ) {
      out.push(cargoCompileLast);
    }
    cargoCompileCount = 0;
    cargoCompileFirst = null;
    cargoCompileLast = null;
  };

  const flushDupRun = () => {
    if (prev !== null && dupRun > 1) {
      out.push(`  ... (${dupRun - 1} duplicate lines)`);
    }
    prev = null;
    dupRun = 0;
  };

  const flushAll = () => {
    flushNpmWarn();
    flushCargoCompile();
    flushDupRun();
  };

  for (const line of lines) {
    // npm err! always wins — emit and reset all buckets
    if (RE_NPM_ERR.test(line)) {
      flushAll();
      out.push(line);
      continue;
    }

    // Errors of any kind: flush, emit, never collapse
    if (
      RE_CARGO_ERROR.test(line) ||
      RE_TSC_ERROR.test(line) ||
      RE_ESLINT_ERROR.test(line) ||
      RE_GENERIC_ERROR.test(line)
    ) {
      flushAll();
      out.push(line);
      continue;
    }

    // npm summary / vulnerabilities — keep verbatim
    if (RE_NPM_SUMMARY.test(line) || RE_NPM_VULN.test(line)) {
      flushAll();
      out.push(line);
      continue;
    }

    // npm WARN deprecated → bucket
    if (RE_NPM_DEPRECATED.test(line)) {
      flushCargoCompile();
      flushDupRun();
      npmDeprecatedCount += 1;
      continue;
    }

    // npm WARN/notice → bucket
    if (RE_NPM_WARN.test(line)) {
      flushCargoCompile();
      flushDupRun();
      npmWarnCount += 1;
      continue;
    }

    // cargo Compiling/Checking/etc → bucket (keep first + last)
    if (RE_CARGO_COMPILING.test(line) || RE_CARGO_FRESH.test(line)) {
      flushNpmWarn();
      flushDupRun();
      // Always keep "Finished" verbatim — it's the success summary
      if (/^\s*Finished\b/.test(line)) {
        flushCargoCompile();
        out.push(line);
        continue;
      }
      cargoCompileCount += 1;
      if (cargoCompileFirst === null) cargoCompileFirst = line;
      cargoCompileLast = line;
      continue;
    }

    // cargo/rustc warning → cap at WARNING_KEEP_MAX
    if (RE_CARGO_WARNING.test(line)) {
      flushAll();
      warningCount += 1;
      if (warningCount <= WARNING_KEEP_MAX) {
        out.push(line);
      } else if (warningCount === WARNING_KEEP_MAX + 1) {
        out.push(`  ... (additional warnings truncated, threshold=${WARNING_KEEP_MAX})`);
      }
      continue;
    }

    // npm/yarn/pnpm script header line → keep
    if (RE_NPM_RUN.test(line) || RE_YARN.test(line) || RE_YARN_INFO.test(line)) {
      flushAll();
      out.push(line);
      continue;
    }

    // Generic line: collapse exact consecutive duplicates only
    flushNpmWarn();
    flushCargoCompile();

    if (line === prev) {
      dupRun += 1;
      continue;
    }
    flushDupRun();
    out.push(line);
    prev = line;
    dupRun = 1;
  }

  flushAll();

  return out.join("\n");
}

buildOutput.filterName = "build-output";
