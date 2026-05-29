// SQLite connection singleton. Opens one shared better-sqlite3 Database per
// process, applies pragmas, runs schema.sql, triggers auto-migration from
// legacy JSON on first boot. Only runs in the Node.js path (`!isCloud`);
// cloud/Workers callers must not import this file.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { warn, info } from "@/sse/utils/logger.js";
import { migrateFromJson } from "./migrate-from-json.js";
import { SCHEMA_SQL } from "./schema.js";

const require = createRequire(import.meta.url);

const APP_NAME = "pod";
const SQLITE_FILE_NAME = "pod.sqlite";
const SCHEMA_VERSION = "1";

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const homeDir = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), APP_NAME);
  }
  return path.join(homeDir, `.${APP_NAME}`);
}

function tryEnsureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    // Verify we can actually write to it
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export const DATA_DIR = (() => {
  const primary = getDataDir();
  if (tryEnsureDir(primary)) return primary;
  // Fallback to ~/.pod if primary is inaccessible (EACCES/EPERM)
  const fallback = path.join(os.homedir(), ".pod");
  warn("sqlite", `DATA_DIR ${primary} not accessible, falling back to ${fallback}`);
  tryEnsureDir(fallback);
  return fallback;
})();

export const SQLITE_FILE = path.join(DATA_DIR, SQLITE_FILE_NAME);

let dbInstance = null;
let schemaReady = false;

function applyPragmas(db) {
  // bun:sqlite has no `.pragma()` shorthand — fall back to exec.
  const setPragma = typeof db.pragma === "function" ? (s) => db.pragma(s) : (s) => db.exec(`PRAGMA ${s}`);
  setPragma("journal_mode = WAL");
  setPragma("synchronous = NORMAL");
  setPragma("foreign_keys = ON");
  setPragma("busy_timeout = 5000");
  // Memory tuning: keep footprint small for embedded use.
  // cache_size: 16 MB page cache (was 64 MB — unnecessary for this schema).
  // mmap_size: 64 MB (was 256 MB — mmap'd pages count toward RSS on Linux,
  //   especially under Bun/JSC which holds freed memory longer than Node/V8).
  // temp_store: MEMORY for temp tables (small, bounded by query complexity).
  setPragma("cache_size = -16000"); // 16 MB
  setPragma("mmap_size = 67108864"); // 64 MB
  setPragma("temp_store = MEMORY");
  setPragma("wal_autocheckpoint = 1000");
}

function ensureSchema(db) {
  if (schemaReady) return;
  db.exec(SCHEMA_SQL);
  schemaReady = true;
}

function hasColumn(db, tableName, columnName) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((col) => String(col.name) === columnName);
  } catch {
    return false;
  }
}

function ensureSchemaPatches(db) {
  const apiKeyColumns = [
    ["limit_type", "limit_type TEXT NOT NULL DEFAULT 'unlimited'"],
    ["requests_per_minute", "requests_per_minute INTEGER"],
    ["concurrent_requests", "concurrent_requests INTEGER"],
  ];

  for (const [column, ddl] of apiKeyColumns) {
    if (!hasColumn(db, "api_keys", column)) {
      db.exec(`ALTER TABLE api_keys ADD COLUMN ${ddl}`);
    }
  }

  db.exec("UPDATE api_keys SET limit_type = 'unlimited' WHERE limit_type IS NULL OR trim(limit_type) = ''");

  // Add combo column to request_log if missing
  if (!hasColumn(db, "request_log", "combo")) {
    db.exec("ALTER TABLE request_log ADD COLUMN combo TEXT");
  }

  // Add details_id column to request_log if missing
  if (!hasColumn(db, "request_log", "details_id")) {
    db.exec("ALTER TABLE request_log ADD COLUMN details_id TEXT");
  }

  // Add sort_order column to combos if missing
  if (!hasColumn(db, "combos", "sort_order")) {
    db.exec("ALTER TABLE combos ADD COLUMN sort_order INTEGER");
    // Backfill existing rows with rowid-based order
    db.exec("UPDATE combos SET sort_order = rowid WHERE sort_order IS NULL");
  }

  // Add last_access_at column to api_keys if missing
  if (!hasColumn(db, "api_keys", "last_access_at")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN last_access_at TEXT");
  }

  // Add models_dev_pricing table if missing
  db.exec(`
    CREATE TABLE IF NOT EXISTS models_dev_pricing (
      provider TEXT NOT NULL,
      model    TEXT NOT NULL,
      data     TEXT NOT NULL,
      PRIMARY KEY (provider, model)
    )
  `);

  // Add models_dev_sync_meta table if missing
  db.exec(`
    CREATE TABLE IF NOT EXISTS models_dev_sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function readMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function writeMeta(db, key, value) {
  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    String(value),
  );
}

function runInitialMigration(db) {
  if (readMeta(db, "schema_version")) return;

  const summary = migrateFromJson(db, DATA_DIR);
  if (summary && summary.imported > 0) {
    info("sqlite", "migrated legacy JSON", summary);
  }
  writeMeta(db, "schema_version", SCHEMA_VERSION);
}

export function getDatabase() {
  if (dbInstance) return dbInstance;

  // DATA_DIR is already ensured at module load time via tryEnsureDir

  // Under Bun, better-sqlite3 (native N-API) is unsupported — use the
  // built-in `bun:sqlite` instead. Both modules are kept external in
  // next.config.mjs so webpack leaves the require calls untouched and
  // they're resolved by the runtime's createRequire at call time.
  const Database = typeof Bun !== "undefined" ? require("bun:sqlite").Database : require("better-sqlite3");
  const db = new Database(SQLITE_FILE);
  applyPragmas(db);
  ensureSchema(db);
  ensureSchemaPatches(db);
  runInitialMigration(db);

  dbInstance = db;
  return dbInstance;
}

export function closeDatabase() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
    schemaReady = false;
  }
}

// Run `fn(db)` inside a BEGIN IMMEDIATE transaction. Returns fn's result.
export function tx(fn) {
  const db = getDatabase();
  const wrapped = db.transaction(fn);
  return wrapped.immediate(db);
}
