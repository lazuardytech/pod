import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";
import { error as logError } from "@/sse/utils/logger";

const execFileAsync = promisify(execFile);

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = ["storage.serviceMachineId", "storage.machineId", "telemetry.machineId"];

/** Get candidate db paths by platform */
function getCandidatePaths(platform: any) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
      join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(appData, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Programs", "Cursor", "User", "globalStorage", "state.vscdb"),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

const _normalize = (value: any) => {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
};

/**
 * Extract tokens via better-sqlite3 (bundled dependency).
 * This is the preferred strategy — no external CLI required.
 */
function extractTokensViaBetterSqlite(dbPath: any) {
  // Dynamic require so the route stays importable even if native bindings fail.
  // `bun:sqlite` is marked as a server external package in next.config.mjs,
  // so require() resolves it at runtime under Bun.
  const isBun = typeof Bun !== "undefined";
  const Database = isBun ? require("bun:sqlite").Database : require("better-sqlite3");
  // bun:sqlite uses `create: false` to require an existing file;
  // better-sqlite3 uses `fileMustExist: true`.
  const db = isBun
    ? new Database(dbPath, { readonly: true, create: false })
    : new Database(dbPath, { readonly: true, fileMustExist: true });

  const query = (key: any) => {
    const row = db.prepare("SELECT value FROM itemTable WHERE key=? LIMIT 1").get(key);
    return row?.value || null;
  };

  const normalize = (value: any) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    const raw = query(key);
    if (raw) {
      accessToken = normalize(raw);
      break;
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    const raw = query(key);
    if (raw) {
      machineId = normalize(raw);
      break;
    }
  }

  db.close();
  return { accessToken, machineId };
}

/**
 * Extract tokens via sqlite3 CLI.
 * Fallback when better-sqlite3 native bindings are unavailable.
 */
async function extractTokensViaCLI(dbPath: any) {
  const normalize = (raw: any) => {
    const value = raw.trim();
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const query = async (key: any) => {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [
        dbPath,
        "-cmd",
        ".parameter init",
        "-cmd",
        `.parameter set @key ${JSON.stringify(key)}`,
        "SELECT value FROM itemTable WHERE key=@key LIMIT 1",
      ],
      {
        timeout: 10000,
      },
    );
    return stdout.trim();
  };

  // Try each key in priority order
  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(key);
      if (raw) {
        accessToken = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      const raw = await query(key);
      if (raw) {
        machineId = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  return { accessToken, machineId };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 * Strategy: better-sqlite3 → sqlite3 CLI → manual fallback
 */
export async function GET(request: any) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const platform = process.platform;
    const candidates = getCandidatePaths(platform);

    let dbPath: string | null = null;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        dbPath = candidate;
        break;
      } catch {
        // Try next candidate
      }
    }

    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error: `Cursor database not found. Checked locations:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`,
      });
    }

    // On Linux, verify Cursor is actually installed (not just leftover config)
    if (platform === "linux") {
      let cursorInstalled = false;
      try {
        await execFileAsync("which", ["cursor"], { timeout: 5000 });
        cursorInstalled = true;
      } catch {
        try {
          const desktopFile = join(homedir(), ".local/share/applications/cursor.desktop");
          await access(desktopFile, constants.R_OK);
          cursorInstalled = true;
        } catch {
          /* not found */
        }
      }
      if (!cursorInstalled) {
        return NextResponse.json({
          found: false,
          error:
            "Cursor config files found but Cursor IDE does not appear to be installed. Skipping auto-import.",
        });
      }
    }

    // Strategy 1: better-sqlite3 (bundled — no external tools required)
    try {
      const tokens = extractTokensViaBetterSqlite(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch {
      // Native bindings unavailable — try CLI fallback
    }

    // Strategy 2: sqlite3 CLI
    try {
      const tokens = await extractTokensViaCLI(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch {
      // sqlite3 CLI not available either
    }

    // Strategy 3: ask user to paste manually
    return NextResponse.json({ found: false, windowsManual: true, dbPath });
  } catch (error) {
    logError("CursorAutoImport", "Cursor auto-import failed", {
      error: (error as any)?.message || error,
    });
    return NextResponse.json({ found: false, error: sanitizeError(error) }, { status: 500 });
  }
}
