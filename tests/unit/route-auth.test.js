import { beforeEach, describe, expect, it, vi } from "vitest";

const jsonMock = vi.fn((body, init) => ({
  status: init?.status || 200,
  body,
  json: async () => body,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: jsonMock,
  },
}));

const jwtVerifyMock = vi.fn();
vi.mock("jose", () => ({
  jwtVerify: jwtVerifyMock,
}));

const getSettingsMock = vi.fn();
const validateApiKeyMock = vi.fn();
vi.mock("@/lib/localDb", () => ({
  getSettings: getSettingsMock,
  validateApiKey: validateApiKeyMock,
}));

const getConsistentMachineIdMock = vi.fn(async () => "cli-token");
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: getConsistentMachineIdMock,
}));

const extractApiKeyMock = vi.fn();
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: extractApiKeyMock,
}));

function createRequest({ headers = {}, cookies = {} } = {}) {
  return {
    headers: {
      get: vi.fn((key) => headers[key] ?? null),
    },
    cookies: {
      get: vi.fn((key) => {
        const value = cookies[key];
        return value ? { value } : undefined;
      }),
    },
  };
}

describe("routeAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockResolvedValue({ requireLogin: true });
    validateApiKeyMock.mockResolvedValue(false);
    extractApiKeyMock.mockReturnValue(null);
    jwtVerifyMock.mockRejectedValue(new Error("invalid"));
  });

  it("strict dashboard auth rejects unauthenticated requests", async () => {
    const { checkStrictDashboardAuth } = await import("@/lib/routeAuth.js");

    const response = await checkStrictDashboardAuth(createRequest());

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  it("strict dashboard auth accepts the local CLI token", async () => {
    const { checkStrictDashboardAuth, CLI_TOKEN_HEADER } = await import("@/lib/routeAuth.js");

    const response = await checkStrictDashboardAuth(
      createRequest({
        headers: {
          [CLI_TOKEN_HEADER]: "cli-token",
        },
      }),
    );

    expect(response).toBe(null);
  });

  it("dashboard API auth can allow requests when requireLogin=false", async () => {
    const { checkDashboardApiAuth } = await import("@/lib/routeAuth.js");
    getSettingsMock.mockResolvedValue({ requireLogin: false });

    const response = await checkDashboardApiAuth(createRequest());

    expect(response).toBe(null);
  });

  it("requireValidApiKey rejects missing API keys", async () => {
    const { requireValidApiKey } = await import("@/lib/routeAuth.js");

    const result = await requireValidApiKey(createRequest());

    expect(result.apiKey).toBe(null);
    expect(result.response.status).toBe(401);
    expect(result.response.body.error).toBe("Missing API key");
  });

  it("requireValidApiKey accepts validated API keys", async () => {
    const { requireValidApiKey } = await import("@/lib/routeAuth.js");
    extractApiKeyMock.mockReturnValue("sk-valid");
    validateApiKeyMock.mockResolvedValue(true);

    const result = await requireValidApiKey(createRequest());

    expect(result.response).toBe(null);
    expect(result.apiKey).toBe("sk-valid");
  });
});
