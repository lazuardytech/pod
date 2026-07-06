interface Env {
  DB: D1Database;
  KV: KVNamespace;
  API_KEY_SECRET?: string;
  CLOUD_SYNC_SECRET?: string;
}
