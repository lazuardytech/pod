// Next compiles this file for Edge as well as Node. Keep this module free of
// node: imports — Node startup lives in instrumentation.node.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { register: registerNode } = await import("./instrumentation.node.ts");
  await registerNode();
}
