// Stub for cloud worker - no-op async functions
export async function saveRequestUsage(): Promise<void> {}
export async function saveRequestDetail(): Promise<void> {}
export function trackPendingRequest(): void {}
export async function appendRequestLog(): Promise<void> {}
export function generateDetailId(model = "unknown"): string {
  return `${Date.now()}-${model}-${Math.random().toString(36).slice(2, 8)}`;
}
export async function getUsageDb(): Promise<{ data: { history: unknown[] } }> {
  return { data: { history: [] } };
}
export async function getUsageHistory(): Promise<unknown[]> {
  return [];
}
export async function getUsageStats(): Promise<Record<string, unknown>> {
  return {};
}
export async function getRecentLogs(): Promise<unknown[]> {
  return [];
}
