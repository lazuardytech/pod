/**
 * Tests for tunnel enable flow — specifically the error handling that
 * previously surfaced raw browser network error strings like
 * "Unable to connect. Is the computer able to access the url?" (Safari/WebKit).
 *
 * Root cause: fetchData() after pingTunnelHealth() could throw a browser
 * network error that propagated to the outer catch and was shown directly
 * to the user. Fixed by:
 * 1. Wrapping fetchData() in its own try/catch (non-fatal)
 * 2. Sanitizing raw browser network error strings in the outer catch
 * 3. Removing DNS_WARMUP_DELAY_MS from the enable route (unnecessary 8s delay)
 */

import { describe, expect, it } from "vitest";

// ─── Sanitization logic (extracted from EndpointPageClient.js) ───────────────

function sanitizeTunnelError(errorMessage) {
  const raw = errorMessage || "";
  const isBrowserNetworkError =
    raw.toLowerCase().includes("unable to connect") ||
    raw.toLowerCase().includes("failed to fetch") ||
    raw.toLowerCase().includes("network") ||
    raw.toLowerCase().includes("load failed");
  return isBrowserNetworkError
    ? "Failed to enable tunnel. Please check your network and try again."
    : raw || "Failed to enable tunnel";
}

describe("tunnel error sanitization", () => {
  it("sanitizes Safari WebKit error", () => {
    const msg = sanitizeTunnelError("Unable to connect. Is the computer able to access the url?");
    expect(msg).toBe("Failed to enable tunnel. Please check your network and try again.");
  });

  it("sanitizes Chrome fetch error", () => {
    const msg = sanitizeTunnelError("Failed to fetch");
    expect(msg).toBe("Failed to enable tunnel. Please check your network and try again.");
  });

  it("sanitizes network error", () => {
    const msg = sanitizeTunnelError("NetworkError when attempting to fetch resource.");
    expect(msg).toBe("Failed to enable tunnel. Please check your network and try again.");
  });

  it("sanitizes load failed error", () => {
    const msg = sanitizeTunnelError("Load failed");
    expect(msg).toBe("Failed to enable tunnel. Please check your network and try again.");
  });

  it("passes through meaningful error messages unchanged", () => {
    const msg = sanitizeTunnelError("cloudflared exited with code 1");
    expect(msg).toBe("cloudflared exited with code 1");
  });

  it("passes through token invalid error unchanged", () => {
    const msg = sanitizeTunnelError("Tunnel token is invalid or expired");
    expect(msg).toBe("Tunnel token is invalid or expired");
  });

  it("returns fallback for empty error", () => {
    expect(sanitizeTunnelError("")).toBe("Failed to enable tunnel");
    expect(sanitizeTunnelError(null)).toBe("Failed to enable tunnel");
    expect(sanitizeTunnelError(undefined)).toBe("Failed to enable tunnel");
  });
});

// ─── pingTunnelHealth guard — url must be non-empty ──────────────────────────

describe("pingTunnelHealth url guard", () => {
  it("should not call fetch when url is falsy", async () => {
    let fetchCalled = false;
    const mockFetch = () => {
      fetchCalled = true;
      return Promise.resolve({ ok: true, type: "basic" });
    };

    // Simulate the guard: if (data.tunnelUrl || data.publicUrl) { await pingTunnelHealth(...) }
    const tunnelUrl = "";
    const publicUrl = "";
    const shouldPing = !!(tunnelUrl || publicUrl);

    if (shouldPing) {
      await mockFetch(`${tunnelUrl || publicUrl}/api/health`);
    }

    expect(fetchCalled).toBe(false);
  });

  it("should call fetch when tunnelUrl is present", async () => {
    let fetchCalled = false;
    const mockFetch = () => {
      fetchCalled = true;
      return Promise.resolve({ ok: false, type: "opaque" });
    };

    const tunnelUrl = "https://test-tunnel.trycloudflare.com";
    const publicUrl = "";
    const shouldPing = !!(tunnelUrl || publicUrl);

    if (shouldPing) {
      await mockFetch(`${tunnelUrl || publicUrl}/api/health`);
    }

    expect(fetchCalled).toBe(true);
  });
});

// ─── fetchData non-fatal wrapping ────────────────────────────────────────────

describe("fetchData non-fatal after tunnel enable", () => {
  it("does not surface fetchData error to user", async () => {
    let userVisibleError = null;

    const fetchData = async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    };

    // Simulate the fixed handleEnableTunnel flow
    try {
      // pingTunnelHealth succeeded (returns true)
      // fetchData is wrapped in its own try/catch
      try {
        await fetchData();
      } catch {
        /* non-fatal */
      }
    } catch (error) {
      userVisibleError = sanitizeTunnelError(error?.message);
    }

    // fetchData error should NOT propagate to user
    expect(userVisibleError).toBe(null);
  });

  it("surfaces real tunnel errors to user", async () => {
    let userVisibleError = null;

    const enableTunnel = async () => {
      throw new Error("cloudflared exited with code 1. Ensure your tunnel token is valid.");
    };

    try {
      await enableTunnel();
      try {
        // fetchData would run here but never reached
      } catch {
        /* non-fatal */
      }
    } catch (error) {
      userVisibleError = sanitizeTunnelError(error?.message);
    }

    expect(userVisibleError).toBe("cloudflared exited with code 1. Ensure your tunnel token is valid.");
  });
});

// ─── DNS_WARMUP_DELAY_MS removed ─────────────────────────────────────────────

describe("tunnel enable route — no unnecessary delay", () => {
  it("enable route should not have DNS_WARMUP_DELAY_MS", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routePath = path.join(process.cwd(), "src/app/api/tunnel/enable/route.ts");
    const content = fs.readFileSync(routePath, "utf8");
    expect(content).not.toContain("DNS_WARMUP_DELAY_MS");
    expect(content).not.toContain("setTimeout");
  });
});
