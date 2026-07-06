/** Loose JSON body / DB row shape for API route narrowing. */
export type ApiRecord = Record<string, unknown>;

export function asApiRecord(value: unknown): ApiRecord {
  return (value ?? {}) as ApiRecord;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Read error message from validateFetchUrl result without union-narrowing issues. */
export function fetchUrlError(result: { ok: boolean; error?: string }): string {
  return result.ok ? "" : (result.error ?? "Invalid URL");
}

export function proxyTestError(result: { ok: boolean; error?: string; status?: number }): string {
  return result.ok
    ? ""
    : (result.error ?? `Proxy test failed with status ${result.status ?? "unknown"}`);
}

export function asRecord(value: unknown): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ApiRecord) : {};
}
