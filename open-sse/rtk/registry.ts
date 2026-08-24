import { FILTERS } from "./constants.ts";
import type { RtkFilterFn } from "./applyFilter.ts";
import { buildOutput } from "./filters/buildOutput.ts";
import { dedupLog } from "./filters/dedupLog.ts";
import { find } from "./filters/find.ts";
import { gitDiff } from "./filters/gitDiff.ts";
import { gitStatus } from "./filters/gitStatus.ts";
import { grep } from "./filters/grep.ts";
import { ls } from "./filters/ls.ts";
import { readNumbered } from "./filters/readNumbered.ts";
import { searchList } from "./filters/searchList.ts";
import { smartTruncate } from "./filters/smartTruncate.ts";
import { tree } from "./filters/tree.ts";

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
