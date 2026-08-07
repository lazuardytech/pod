import { FILTERS } from "./constants.js";
import type { RtkFilterFn } from "./applyFilter.js";
import { buildOutput } from "./filters/buildOutput.js";
import { dedupLog } from "./filters/dedupLog.js";
import { find } from "./filters/find.js";
import { gitDiff } from "./filters/gitDiff.js";
import { gitStatus } from "./filters/gitStatus.js";
import { grep } from "./filters/grep.js";
import { ls } from "./filters/ls.js";
import { readNumbered } from "./filters/readNumbered.js";
import { searchList } from "./filters/searchList.js";
import { smartTruncate } from "./filters/smartTruncate.js";
import { tree } from "./filters/tree.js";

const REGISTRY: Record<string, RtkFilterFn> = {
  [FILTERS.GIT_DIFF]: gitDiff as RtkFilterFn,
  [FILTERS.GIT_STATUS]: gitStatus as RtkFilterFn,
  [FILTERS.GREP]: grep as RtkFilterFn,
  [FILTERS.FIND]: find as RtkFilterFn,
  [FILTERS.DEDUP_LOG]: dedupLog as RtkFilterFn,
  [FILTERS.LS]: ls as RtkFilterFn,
  [FILTERS.TREE]: tree as RtkFilterFn,
  [FILTERS.SMART_TRUNCATE]: smartTruncate as RtkFilterFn,
  [FILTERS.READ_NUMBERED]: readNumbered as RtkFilterFn,
  [FILTERS.SEARCH_LIST]: searchList as RtkFilterFn,
  [FILTERS.BUILD_OUTPUT]: buildOutput as RtkFilterFn,
};

// Rust resolve_filter aliases (pipe_cmd.rs): grep|rg, find|fd
const ALIASES: Record<string, RtkFilterFn> = {
  rg: grep as RtkFilterFn,
  fd: find as RtkFilterFn,
};

export function resolveFilter(name: string): RtkFilterFn | null {
  return REGISTRY[name] || ALIASES[name] || null;
}

export function allFilters() {
  return REGISTRY;
}
