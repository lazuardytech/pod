import * as fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock("@/lib/routeAuth.js", () => ({
  checkStrictDashboardAuth: vi.fn(async () => null),
}));

// Shared mock db instance
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 - return constructor directly
vi.mock("better-sqlite3", () => {
  const MockDatabase = vi.fn().mockImplementation(() => {
    if (mockDbInstance.__throwOnConstruct) {
      throw new Error("SQLITE_CANTOPEN");
    }
    return mockDbInstance;
  });
  return MockDatabase;
});

// Mock bun:sqlite - return object with Database constructor
vi.mock("bun:sqlite", () => {
  const MockDatabase = vi.fn().mockImplementation(() => {
    if (mockDbInstance.__throwOnConstruct) {
      throw new Error("SQLITE_CANTOPEN");
    }
    return mockDbInstance;
  });
  return {
    Database: MockDatabase,
  };
});

// Mock child_process for Strategy 2 fallback
let cliMockResults = {};
const execFileMock = vi.fn((file, args, opts, cb) => {
  const sql =
    args.find((arg) => typeof arg === "string" && arg.includes("SELECT value FROM itemTable")) ||
    "";
  const parameterArg =
    args.find((arg) => typeof arg === "string" && arg.includes(".parameter set @key")) || "";
  let stdout = "";

  for (const [key, value] of Object.entries(cliMockResults)) {
    if (parameterArg.includes(JSON.stringify(key)) && sql.includes("WHERE key=@key LIMIT 1")) {
      stdout = value;
      break;
    }
  }

  if (typeof cb === "function") {
    cb(null, { stdout });
  }
  return { stdout };
});
vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

// We need to dynamically import after mocks are registered
let GET;

function createRequest() {
  return {
    headers: { get: vi.fn(() => null) },
    cookies: { get: vi.fn(() => undefined) },
  };
}

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    cliMockResults = {};
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET(createRequest());

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Checked locations:");
  });

  it("returns windowsManual: true if db file exists but cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;
    // Ensure CLI also "fails" or returns nothing
    cliMockResults = {};

    const response = await GET(createRequest());

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  it("falls back to sqlite3 CLI with parameter binding instead of raw key interpolation", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;
    cliMockResults = {
      "cursorAuth/accessToken": "cli-token",
      "storage.serviceMachineId": "cli-machine-id",
    };

    const response = await GET(createRequest());

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("cli-token");
    expect(response.body.machineId).toBe("cli-machine-id");
    expect(execFileMock).toHaveBeenCalled();
    const flattenedArgs = execFileMock.mock.calls.flatMap(([, args]) => args);
    expect(flattenedArgs).toContain("SELECT value FROM itemTable WHERE key=@key LIMIT 1");
    expect(flattenedArgs.join(" ")).not.toContain("WHERE key='cursorAuth/accessToken'");
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: vi.fn().mockImplementation((key) => {
        const map = {
          "cursorAuth/accessToken": "test-token",
          "storage.serviceMachineId": "test-machine-id",
        };
        return map[key] ? { value: map[key] } : undefined;
      }),
    });
    cliMockResults = {
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    };

    const response = await GET(createRequest());

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: vi.fn().mockImplementation((key) => {
        const map = {
          "cursorAuth/accessToken": '"json-token"',
          "storage.serviceMachineId": '"json-machine-id"',
        };
        return map[key] ? { value: map[key] } : undefined;
      }),
    });
    cliMockResults = {
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    };

    const response = await GET(createRequest());

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  // ── Fuzzy fallback (Removed in source, source uses multi-key loop instead) ───────────────────────────────────────

  it("tries multiple keys if first one is missing", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: vi.fn().mockImplementation((key) => {
        const map = {
          "cursorAuth/token": "fallback-token",
          "storage.machineId": "fallback-machine",
        };
        return map[key] ? { value: map[key] } : undefined;
      }),
    });
    cliMockResults = {
      "cursorAuth/token": "fallback-token",
      "storage.machineId": "fallback-machine",
    };

    const response = await GET(createRequest());

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  it("returns windowsManual error when tokens are missing even after all keys checked", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: vi.fn().mockReturnValue(null),
    });
    cliMockResults = {};

    const response = await GET(createRequest());

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  // ── Backwards-compatible: linux/win32 keep original single-path logic ─

  it("linux uses generic not-found message with all path positions", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET(createRequest());

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Checked locations:");
    // fs/promises.access is called on the linux candidate paths
    expect(fsPromises.access).toHaveBeenCalled();
  });

  it("unsupported platform returns generic not-found (200)", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Checked locations:");
  });
});
