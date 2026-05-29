// Stub for cloud worker - no-op async functions
export async function saveRequestUsage() {}
export async function saveRequestDetail() {}
export function trackPendingRequest() {}
export async function appendRequestLog() {}
export function generateDetailId(model = "unknown") {
  return `${Date.now()}-${model}-${Math.random().toString(36).slice(2, 8)}`;
}
export async function getUsageDb() {
  return { data: { history: [] } };
}
export async function getUsageHistory() {
  return [];
}
export async function getUsageStats() {
  return {};
}
export async function getRecentLogs() {
  return [];
}
