/**
 * Strip built-in/duplicate tools when equivalent MCP tools are present.
 * Goal: reduce tool definitions token bloat for Claude clients.
 */

type ToolLike = {
  name?: string;
  function?: { name?: string };
};

type NamePattern = string | RegExp;

const DEDUP_RULES: Array<{ triggers: NamePattern[]; strip: NamePattern[] }> = [
  {
    // Exa MCP present → drop built-in web tools (Exa is preferred).
    triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Tavily MCP present → drop built-in web tools.
    triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Browser MCP present → drop Cowork's duplicate Claude_in_Chrome connector.
    triggers: [/^mcp__browsermcp__/],
    strip: [/^mcp__Claude_in_Chrome__/],
  },
];

function getToolName(t: ToolLike | null | undefined) {
  return t?.name || t?.function?.name || "";
}

function matches(name: string, pattern: NamePattern) {
  if (typeof pattern === "string") return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

function dedupeTools(tools: unknown) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] as string[] };
  const toolList = tools as ToolLike[];
  const names = toolList.map(getToolName);
  const toStrip = new Set<string>();
  for (const rule of DEDUP_RULES) {
    const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
    if (!hasTrigger) continue;
    for (const n of names) {
      if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
    }
  }
  if (toStrip.size === 0) return { tools, stripped: [] as string[] };
  const out = toolList.filter((t) => !toStrip.has(getToolName(t)));
  return { tools: out, stripped: Array.from(toStrip) };
}

export { dedupeTools };
