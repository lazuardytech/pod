export const MemoryType = {
  FACTUAL: "factual",
  EPISODIC: "episodic",
  PROCEDURAL: "procedural",
  SEMANTIC: "semantic",
} as const;

export type MemoryTypeValue = (typeof MemoryType)[keyof typeof MemoryType];

export const MEMORY_TYPES: Set<MemoryTypeValue> = new Set(Object.values(MemoryType));
