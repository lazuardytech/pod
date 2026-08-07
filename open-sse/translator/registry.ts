/** Translator request/response registry (split to avoid circular ESM init). */
export type TranslatorRequestPayload = Record<string, unknown>;
export type TranslatorCredentials =
  | (Record<string, unknown> & {
      accessToken?: string;
      apiKey?: string;
      providerSpecificData?: Record<string, unknown>;
    })
  | null;
export type TranslatorState = Record<string, unknown>;
export type TranslatorResponseChunk = unknown;
export type TranslatorResponseResult =
  | TranslatorResponseChunk
  | readonly TranslatorResponseChunk[]
  | null
  | undefined;
export type TranslatedResponseResults = TranslatorResponseChunk[] & {
  _openaiIntermediate?: TranslatorResponseChunk[];
};

export type TranslatorRequestFn = (
  model: string,
  body: TranslatorRequestPayload,
  stream: boolean,
  credentials?: TranslatorCredentials,
) => TranslatorRequestPayload;
export type TranslatorResponseFn = (
  chunk: TranslatorResponseChunk,
  state: TranslatorState,
) => TranslatorResponseResult;

export const requestRegistry = new Map<string, TranslatorRequestFn>();
export const responseRegistry = new Map<string, TranslatorResponseFn>();

export function getRegisteredRequestTranslatorKeys(): readonly string[] {
  return Array.from(requestRegistry.keys());
}

export function getRegisteredResponseTranslatorKeys(): readonly string[] {
  return Array.from(responseRegistry.keys());
}

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
