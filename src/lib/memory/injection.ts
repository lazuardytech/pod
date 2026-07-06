const PROVIDERS_WITHOUT_SYSTEM_MESSAGE = new Set([
  "o1",
  "o1-mini",
  "o1-preview",
  "glm",
  "glmt",
  "glm-cn",
  "zai",
  "qianfan",
]);

export function providerSupportsSystemMessage(provider: string | null | undefined): boolean {
  if (!provider) return true;
  return !PROVIDERS_WITHOUT_SYSTEM_MESSAGE.has(String(provider).toLowerCase().trim());
}

export type MemoryEntry = { content?: string };

export function formatMemoryContext(memories: unknown): string {
  if (!Array.isArray(memories) || memories.length === 0) return "";
  const content = (memories as MemoryEntry[])
    .map((m) => String(m?.content || "").trim())
    .filter(Boolean)
    .join("\n");
  return content ? `Memory context: ${content}` : "";
}

type MessageItem = { role?: string; content?: unknown };

type MemoryConfig = { enabled?: boolean };

type RequestWithMessages = { messages?: MessageItem[] };

export function shouldInjectMemory(request: unknown, config: MemoryConfig = {}): boolean {
  if (config.enabled === false) return false;
  return (
    Array.isArray((request as RequestWithMessages | null)?.messages) &&
    ((request as RequestWithMessages).messages?.length || 0) > 0
  );
}

export function injectMemory<T extends RequestWithMessages>(
  request: T,
  memories: unknown,
  provider: string,
): T {
  if (!Array.isArray(memories) || memories.length === 0) return request;
  const memoryText = formatMemoryContext(memories);
  if (!memoryText) return request;

  const messages = Array.isArray(request?.messages) ? [...request.messages] : [];
  if (providerSupportsSystemMessage(provider)) {
    return { ...request, messages: [{ role: "system", content: memoryText }, ...messages] };
  }
  return { ...request, messages: [{ role: "user", content: memoryText }, ...messages] };
}
