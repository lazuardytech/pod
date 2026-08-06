/** Translator request/response registry (split to avoid circular ESM init). */
// todo(ts): narrow translator fn signatures as converters are typed
export type TranslatorRequestFn = (...args: any[]) => any;
export type TranslatorResponseFn = (...args: any[]) => any;

export const requestRegistry = new Map<string, TranslatorRequestFn>();
export const responseRegistry = new Map<string, TranslatorResponseFn>();

export function register(
  from: string,
  to: string,
  requestFn: TranslatorRequestFn | null | undefined,
  responseFn: TranslatorResponseFn | null | undefined,
): void {
  const key = `${from}:${to}`;
  if (requestFn) requestRegistry.set(key, requestFn);
  if (responseFn) responseRegistry.set(key, responseFn);
}
