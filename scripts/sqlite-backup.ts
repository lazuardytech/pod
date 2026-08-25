/**
 * SQLite snapshot via VACUUM INTO (consistent copy, leaves the live WAL file alone).
 *
 *   bun scripts/sqlite-backup.ts [dest]
 *
 * Source: $DATA_DIR/pod.sqlite (default ~/.pod). Zeabur: DATA_DIR=/app/data.
 * Default dest: $DATA_DIR/backups/pod-<timestamp>.sqlite
 * Optional sidecar/cron; do not scale replicas to share this file.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function dataDir(): string {
  return process.env.DATA_DIR ?? join(homedir(), ".pod");
}

function backup(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const db = new Database(src, { readonly: true, create: false });
  try {
    db.exec(`VACUUM INTO ${sqlString(dest)}`);
  } finally {
    db.close();
  }
}

function selfCheck(): void {
  const dir = join(tmpdir(), `pod-bak-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const src = join(dir, "pod.sqlite");
  const dest = join(dir, "copy.sqlite");
  const seed = new Database(src);
  seed.exec("CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);");
  seed.close();
  backup(src, dest);
  const copy = new Database(dest, { readonly: true, create: false });
  try {
    const row = copy.query("SELECT x FROM t").get() as { x: number } | null;
    if (row?.x !== 1) throw new Error("sqlite-backup self-check failed");
  } finally {
    copy.close();
  }
  console.log("ok", dest);
}

const arg = process.argv[2];
if (arg === "--self-check") {
  selfCheck();
} else {
  const src = join(dataDir(), "pod.sqlite");
  const dest =
    arg ??
    join(dataDir(), "backups", `pod-${new Date().toISOString().replaceAll(/[:.]/g, "")}.sqlite`);
  backup(src, dest);
  console.log(dest);
}
