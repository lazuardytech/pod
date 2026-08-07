// Port of apply_filter (rtk/src/cmds/system/pipe_cmd.rs) — catch_unwind equivalent
// On panic/error: passthrough raw output + warn to stderr

export type RtkFilterFn = ((text: string) => unknown) & {
  filterName?: string;
  name?: string;
};

export function safeApply(fn: RtkFilterFn | unknown, text: string): string {
  if (typeof fn !== "function") return text;
  try {
    const out = (fn as RtkFilterFn)(text);
    if (typeof out !== "string") return text;
    return out;
  } catch (err: unknown) {
    // Rust: eprintln!("[rtk] warning: filter panicked — passing through raw output")
    const typed = fn as RtkFilterFn;
    const name = typed.filterName || typed.name || "anonymous";
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[rtk] warning: filter '${name}' panicked — passing through raw output: ${message || err}`,
    );
    return text;
  }
}
