import { validateFetchUrl } from "@/lib/validateUrl";

type FetchImageOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Used when upstream providers (Codex, etc.) require inline base64 images
 * instead of remote URLs they cannot fetch.
 * Returns null if fetch fails.
 */
export async function fetchImageAsBase64(imageUrl: unknown, options: FetchImageOptions = {}) {
  if (typeof imageUrl !== "string") return null;
  const urlCheck = validateFetchUrl(imageUrl);
  if (!urlCheck.ok) return null;

  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timeout = options.signal ? null : setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = options.signal ?? controller.signal;

  try {
    const response = await fetch(urlCheck.url, { signal: fetchSignal });
    if (!response.ok) return null;

    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { url: `data:${mimeType};base64,${base64}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
