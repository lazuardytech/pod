import crypto from "node:crypto";

const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TTL_MS = 300_000;

type CacheEntry<V> = {
  key: string;
  value: V;
  createdAt: number;
  ttl: number;
  size: number;
  hits: number;
};

type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  bytes: number;
  maxBytes: number;
  hitRate: number;
};

type LRUCacheOptions = {
  maxSize?: number;
  maxBytes?: number;
  defaultTTL?: number;
};

export class LRUCache<V = unknown> {
  #cache = new Map<string, CacheEntry<V>>();
  #maxSize: number;
  #maxBytes: number;
  #defaultTTL: number;
  #currentSize = 0;
  #currentBytes = 0;
  #stats = { hits: 0, misses: 0, evictions: 0 };

  constructor(options: LRUCacheOptions = {}) {
    this.#maxSize = Number.isFinite(options.maxSize) ? (options.maxSize as number) : DEFAULT_MAX_ENTRIES;
    this.#maxBytes = Number.isFinite(options.maxBytes) ? (options.maxBytes as number) : DEFAULT_MAX_BYTES;
    this.#defaultTTL = Number.isFinite(options.defaultTTL) ? (options.defaultTTL as number) : DEFAULT_TTL_MS;
  }

  static generateKey(params: unknown): string {
    const normalized = JSON.stringify(params, Object.keys((params as Record<string, unknown>) || {}).sort());
    return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  #estimateSize(value: V): number {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 1024;
    }
  }

  #deleteEntry(key: string, entry: CacheEntry<V> | undefined): void {
    this.#cache.delete(key);
    this.#currentSize -= 1;
    this.#currentBytes -= entry?.size || 0;
    if (this.#currentBytes < 0) this.#currentBytes = 0;
  }

  get(key: string): V | undefined {
    const entry = this.#cache.get(key);
    if (!entry) {
      this.#stats.misses += 1;
      return undefined;
    }

    if (Date.now() - entry.createdAt > entry.ttl) {
      this.#deleteEntry(key, entry);
      this.#stats.misses += 1;
      return undefined;
    }

    this.#cache.delete(key);
    entry.hits += 1;
    this.#cache.set(key, entry);

    this.#stats.hits += 1;
    return entry.value;
  }

  set(key: string, value: V, ttl?: number): void {
    const entrySize = this.#estimateSize(value);

    if (this.#cache.has(key)) {
      const oldEntry = this.#cache.get(key);
      this.#currentBytes -= oldEntry?.size || 0;
      this.#currentSize -= 1;
      this.#cache.delete(key);
    }

    while (
      (this.#currentSize >= this.#maxSize || this.#currentBytes + entrySize > this.#maxBytes) &&
      this.#cache.size > 0
    ) {
      const oldestKey = this.#cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldestEntry = this.#cache.get(oldestKey);
      if (oldestEntry) this.#deleteEntry(oldestKey, oldestEntry);
      this.#stats.evictions += 1;
    }

    const entry: CacheEntry<V> = {
      key,
      value,
      createdAt: Date.now(),
      ttl: Number.isFinite(ttl) ? (ttl as number) : this.#defaultTTL,
      size: entrySize,
      hits: 0,
    };

    this.#cache.set(key, entry);
    this.#currentSize += 1;
    this.#currentBytes += entrySize;
  }

  has(key: string): boolean {
    const entry = this.#cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.#deleteEntry(key, entry);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    const entry = this.#cache.get(key);
    if (!entry) return false;
    this.#deleteEntry(key, entry);
    return true;
  }

  /**
   * Iterate over all entries including expired ones. Callback receives (key, value, createdAt).
   * Use this with caution — expired entries are included and must be checked.
   */
  forEach(fn: (key: string, value: V, createdAt: number, ttl: number) => void): number {
    let count = 0;
    for (const [key, entry] of this.#cache.entries()) {
      fn(key, entry.value, entry.createdAt, entry.ttl);
      count++;
    }
    return count;
  }

  clear(): void {
    this.#cache.clear();
    this.#currentSize = 0;
    this.#currentBytes = 0;
  }

  getStats(): CacheStats {
    const total = this.#stats.hits + this.#stats.misses;
    return {
      size: this.#currentSize,
      maxSize: this.#maxSize,
      bytes: this.#currentBytes,
      maxBytes: this.#maxBytes,
      ...this.#stats,
      hitRate: total > 0 ? (this.#stats.hits / total) * 100 : 0,
    };
  }
}

let promptCache: LRUCache | null = null;

export function getPromptCache(options: LRUCacheOptions = {}): LRUCache {
  if (!promptCache) {
    promptCache = new LRUCache({
      maxSize: parseInt(process.env.PROMPT_CACHE_MAX_SIZE || "50", 10),
      maxBytes: parseInt(process.env.PROMPT_CACHE_MAX_BYTES || String(2 * 1024 * 1024), 10),
      defaultTTL: parseInt(process.env.PROMPT_CACHE_TTL_MS || "300000", 10),
      ...options,
    });
  }
  return promptCache;
}
