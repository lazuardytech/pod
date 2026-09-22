// Gemini helper functions for translator

// Unsupported JSON Schema constraints that should be removed for Antigravity
export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  // Basic constraints (not supported by Gemini API)
  "minLength",
  "maxLength",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "minItems",
  "maxItems",
  "format",
  // Claude rejects these in VALIDATED mode
  "default",
  "examples",
  // JSON Schema meta keywords
  "$schema",
  "$defs",
  "definitions",
  "const",
  "$ref",
  "$comment",
  // Object validation keywords (not supported)
  "additionalProperties",
  "propertyNames",
  "patternProperties",
  "enumDescriptions",
  // Complex schema keywords (handled by flattenAnyOfOneOf/mergeAllOf)
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  // Dependency keywords (not supported)
  "dependencies",
  "dependentSchemas",
  "dependentRequired",
  // Other unsupported keywords
  "title",
  "if",
  "then",
  "else",
  "contentMediaType",
  "contentEncoding",
  // UI/Styling properties (from Cursor tools - NOT JSON Schema standard)
  "cornerRadius",
  "fillColor",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "gap",
  "padding",
  "strokeColor",
  "strokeThickness",
  "textColor",
];

// Default safety settings
export const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" },
];

// OpenAI content part (trusted shape from chat request payloads)
type OpenAIContentItem = {
  type?: unknown;
  text?: unknown;
  image_url?: { url?: string } | undefined;
  input_audio?: { data?: unknown; format?: string } | undefined;
  audio_url?: { url?: string } | undefined;
};

// Gemini part produced by convertOpenAIContentToParts
type GeminiPart = {
  text?: unknown;
  inlineData?: { mime_type: string; data: unknown };
  fileData?: { fileUri: string; mimeType: string };
};

// Mutable JSON Schema node (trusted: tool schemas are plain records)
type SchemaNode = Record<string, unknown>;

// Convert OpenAI content to Gemini parts
export function convertOpenAIContentToParts(content: unknown): GeminiPart[] {
  const parts: GeminiPart[] = [];

  if (typeof content === "string") {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content as OpenAIContentItem[]) {
      if (item.type === "text") {
        parts.push({ text: item.text });
      } else if (item.type === "image_url" && item.image_url?.url?.startsWith("data:")) {
        const url = item.image_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex); // skip "data:"
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0]!;

          parts.push({
            inlineData: { mime_type: mimeType, data: data },
          });
        }
      } else if (
        item.type === "image_url" &&
        item.image_url?.url &&
        (item.image_url.url.startsWith("http://") || item.image_url.url.startsWith("https://"))
      ) {
        parts.push({
          fileData: { fileUri: item.image_url.url, mimeType: "image/*" },
        });
      } else if (item.type === "input_audio" && item.input_audio?.data) {
        const format = item.input_audio.format || "wav";
        const mimeType = format === "mp3" ? "audio/mpeg" : `audio/${format}`;
        parts.push({
          inlineData: { mime_type: mimeType, data: item.input_audio.data },
        });
      } else if (item.type === "audio_url" && item.audio_url?.url?.startsWith("data:")) {
        const url = item.audio_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0]!;
          parts.push({
            inlineData: { mime_type: mimeType, data: data },
          });
        }
      }
    }
  }

  return parts;
}

// Extract text content from OpenAI content
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const items = content as OpenAIContentItem[];
    return items
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

// Try parse JSON safely
export function tryParseJSON(str: unknown): unknown {
  if (typeof str !== "string") return str;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Generate request ID
export function generateRequestId() {
  return `agent-${crypto.randomUUID()}`;
}

// Generate session ID (binary-compatible format: UUID + timestamp)
export function generateSessionId() {
  return crypto.randomUUID() + Date.now().toString();
}

// Generate project ID
export function generateProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

// Helper: Remove unsupported keywords recursively from object/array
// Also strips all vendor extension fields (x- prefixed) not supported by Gemini
function removeUnsupportedKeywords(obj: unknown, keywords: readonly string[]) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj as unknown[]) {
      removeUnsupportedKeywords(item, keywords);
    }
    return;
  }

  const record = obj as SchemaNode;
  for (const key of Object.keys(record)) {
    if (keywords.includes(key) || key.startsWith("x-")) {
      delete record[key];
      continue;
    }

    const value = record[key];
    if (value && typeof value === "object") {
      removeUnsupportedKeywords(value, keywords);
    }
  }
}

// Convert const to enum
function convertConstToEnum(obj: unknown) {
  if (!obj || typeof obj !== "object") return;

  const record = obj as SchemaNode;
  if (record.const !== undefined && !record.enum) {
    record.enum = [record.const];
    delete record.const;
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      convertConstToEnum(value);
    }
  }
}

// Convert enum values to strings (Gemini requires string enum values + explicit type:"string")
function convertEnumValuesToStrings(obj: unknown) {
  if (!obj || typeof obj !== "object") return;

  const record = obj as SchemaNode;
  if (record.enum && Array.isArray(record.enum)) {
    record.enum = (record.enum as unknown[]).map((v) => String(v));
    // Gemini API requires type:"string" when enum is present — without it returns 400
    if (!record.type) {
      record.type = "string";
    }
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      convertEnumValuesToStrings(value);
    }
  }
}

// Merge allOf schemas
function mergeAllOf(obj: unknown) {
  if (!obj || typeof obj !== "object") return;

  const record = obj as SchemaNode;
  if (record.allOf && Array.isArray(record.allOf)) {
    const merged: { properties?: Record<string, unknown>; required?: unknown[] } = {};

    for (const item of record.allOf as SchemaNode[]) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const req of item.required as unknown[]) {
          if (!merged.required.includes(req)) {
            merged.required.push(req);
          }
        }
      }
    }

    delete record.allOf;
    if (merged.properties)
      record.properties = { ...(record.properties as SchemaNode), ...merged.properties };
    if (merged.required)
      record.required = [...((record.required || []) as unknown[]), ...merged.required];
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      mergeAllOf(value);
    }
  }
}

// Select best schema from anyOf/oneOf
function selectBest(items: SchemaNode[]): number {
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let score = 0;
    const type = item.type;

    if (type === "object" || item.properties) {
      score = 3;
    } else if (type === "array" || item.items) {
      score = 2;
    } else if (type && type !== "null") {
      score = 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

// Flatten anyOf/oneOf
function flattenAnyOfOneOf(obj: unknown) {
  if (!obj || typeof obj !== "object") return;

  const record = obj as SchemaNode;
  if (record.anyOf && Array.isArray(record.anyOf) && record.anyOf.length > 0) {
    const nonNullSchemas = (record.anyOf as SchemaNode[]).filter((s) => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx]!;
      delete record.anyOf;
      Object.assign(record, selected);
    }
  }

  if (record.oneOf && Array.isArray(record.oneOf) && record.oneOf.length > 0) {
    const nonNullSchemas = (record.oneOf as SchemaNode[]).filter((s) => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx]!;
      delete record.oneOf;
      Object.assign(record, selected);
    }
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      flattenAnyOfOneOf(value);
    }
  }
}

// Flatten type arrays
function flattenTypeArrays(obj: unknown) {
  if (!obj || typeof obj !== "object") return;

  const record = obj as SchemaNode;
  if (record.type && Array.isArray(record.type)) {
    const nonNullTypes = (record.type as unknown[]).filter((t) => t !== "null");
    record.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      flattenTypeArrays(value);
    }
  }
}

// Ensure schemas with properties but no type get type:"object"
// Prevents Gemini API errors with tool schemas that omit the type field
function ensureObjectType(obj: unknown) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj as unknown[]) ensureObjectType(item);
    return;
  }

  const record = obj as SchemaNode;
  if (record.properties && !record.type) {
    record.type = "object";
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") ensureObjectType(value);
  }
}

// Clean JSON Schema for Antigravity API compatibility - removes unsupported keywords recursively
export function cleanJSONSchemaForAntigravity<T>(schema: T): T {
  if (!schema || typeof schema !== "object") return schema;

  // Mutate directly (schema is only used once per request)
  const cleaned = schema;

  // Phase 0: Ensure schemas with properties have type:"object"
  ensureObjectType(cleaned);

  // Phase 1: Convert and prepare
  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);

  // Phase 2: Flatten complex structures
  mergeAllOf(cleaned);
  flattenAnyOfOneOf(cleaned);
  flattenTypeArrays(cleaned);

  // Phase 3: Remove all unsupported keywords at ALL levels (including inside arrays)
  removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);

  // Phase 4: Cleanup required fields recursively
  function cleanupRequired(obj: unknown) {
    if (!obj || typeof obj !== "object") return;

    const record = obj as SchemaNode;
    if (record.required && Array.isArray(record.required) && record.properties) {
      const validRequired = (record.required as unknown[]).filter((field) =>
        Object.hasOwn(record.properties as SchemaNode, field as PropertyKey),
      );
      if (validRequired.length === 0) {
        delete record.required;
      } else {
        record.required = validRequired;
      }
    }

    // Recurse into nested objects
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        cleanupRequired(value);
      }
    }
  }

  cleanupRequired(cleaned);

  // Phase 5: Add placeholder for empty object schemas (Antigravity requirement)
  function addPlaceholders(obj: unknown) {
    if (!obj || typeof obj !== "object") return;

    const record = obj as SchemaNode;
    if (record.type === "object") {
      if (!record.properties || Object.keys(record.properties as SchemaNode).length === 0) {
        record.properties = {
          reason: {
            type: "string",
            description: "Brief explanation of why you are calling this tool",
          },
        };
        record.required = ["reason"];
      }
    }

    // Recurse into nested objects
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        addPlaceholders(value);
      }
    }
  }

  addPlaceholders(cleaned);

  return cleaned;
}
