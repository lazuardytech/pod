import { GITHUB_CONFIG } from "../constants/oauth";
import { spinner as createSpinner } from "../utils/ui";
import { OAuthService } from "./oauth";

/**
 * GitHub Copilot OAuth Service
 * Uses Device Code Flow for authentication
 */
export class GitHubService extends OAuthService {
  constructor() {
    super(GITHUB_CONFIG as import("./oauth").LooseOAuthConfig & Record<string, unknown>);
  }

  /**
   * Get device code for GitHub authentication
   */
  // todo(ts): device code response shape from GitHub — keep loose.
  async getDeviceCode(): Promise<Record<string, unknown>> {
    const response = await fetch(`${GITHUB_CONFIG.deviceCodeUrl}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: GITHUB_CONFIG.clientId,
        scope: GITHUB_CONFIG.scopes,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get device code: ${error}`);
    }

    return await response.json();
  }

  /**
   * Poll for access token using device code
   */
  async pollAccessToken(
    deviceCode: string,
    verificationUri: string,
    userCode: string,
    interval: number = 5000,
  ): Promise<{ access_token: string; token_type: string; scope: string }> {
    const spinner = createSpinner("Waiting for GitHub authentication...").start();

    // Show user code and verification URL
    console.log(`\nPlease visit: ${verificationUri}`);
    console.log(`Enter code: ${userCode}\n`);

    // Open browser automatically
    try {
      const open = (await import("open")).default;
      await open(verificationUri);
    } catch (_error) {
      console.log("Could not open browser automatically. Please visit the URL above manually.");
    }

    // Poll for access token
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const response = await fetch(`${GITHUB_CONFIG.tokenUrl}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: GITHUB_CONFIG.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        spinner.succeed("GitHub authentication successful!");
        return {
          access_token: data.access_token,
          token_type: data.token_type,
          scope: data.scope,
        };
      } else if (data.error === "authorization_pending") {
      } else if (data.error === "slow_down") {
        // Increase polling interval
        interval += 5000;
      } else if (data.error === "expired_token") {
        spinner.fail("Device code expired. Please try again.");
        throw new Error("Device code expired");
      } else if (data.error === "access_denied") {
        spinner.fail("Access denied by user.");
        throw new Error("Access denied");
      } else {
        spinner.fail("Failed to get access token.");
        throw new Error(data.error_description || data.error);
      }
    }
  }

  /**
   * Get Copilot token using GitHub access token
   */
  // todo(ts): Copilot token response shape — keep loose.
  async getCopilotToken(accessToken: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${GITHUB_CONFIG.copilotTokenUrl}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get Copilot token: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get user info using GitHub access token
   */
  // todo(ts): GitHub API user response — keep loose.
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${GITHUB_CONFIG.userInfoUrl}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return await response.json();
  }

  /**
   * Complete GitHub Copilot authentication flow
   * GitHub uses Device Code flow; deliberately shadows OAuthService PKCE authenticate.
   */
  // @ts-expect-error — device flow has no PKCE params, shadows parent authenticate.
  async authenticate(): Promise<{
    accessToken: string;
    copilotToken: string;
    refreshToken: null;
    expiresIn: number | string | null;
    userInfo: { id: string; login: string; name: string; email: string };
    copilotTokenInfo: Record<string, unknown>;
  }> {
    try {
      // Get device code
      const deviceResponse = await this.getDeviceCode();

      // Poll for access token
      const tokenResponse = await this.pollAccessToken(
        String(deviceResponse.device_code ?? ""),
        String(deviceResponse.verification_uri ?? ""),
        String(deviceResponse.user_code ?? ""),
      );

      // Get Copilot token
      const accessToken = String(tokenResponse.access_token ?? "");
      const copilotToken = await this.getCopilotToken(accessToken);

      // Get user info
      const userInfo = await this.getUserInfo(accessToken);

      console.log(`\n✅ Successfully authenticated as ${String(userInfo.login ?? "")}`);

      return {
        accessToken,
        copilotToken: String(copilotToken.token ?? ""),
        refreshToken: null, // GitHub device flow doesn't return refresh token
        expiresIn: (copilotToken.expires_at as string | number | null) ?? null,
        userInfo: {
          id: String(userInfo.id ?? ""),
          login: String(userInfo.login ?? ""),
          name: String(userInfo.name ?? ""),
          email: String(userInfo.email ?? ""),
        },
        copilotTokenInfo: copilotToken,
      };
    } catch (error) {
      throw new Error(`GitHub authentication failed: ${(error as Error).message}`);
    }
  }

  /**
   * Connect to server with GitHub credentials
   */
  async connect(): Promise<void> {
    try {
      // Authenticate with GitHub
      const authResult = await this.authenticate();

      // Send credentials to server
      const { server, token, userId } = await import("../config/index").then((m) =>
        m.getServerCredentials(),
      );
      const spinner = (await import("../utils/ui")).spinner("Connecting to server...").start();

      const response = await fetch(`${server}/api/cli/providers/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          accessToken: authResult.accessToken,
          copilotToken: authResult.copilotToken,
          userInfo: authResult.userInfo,
          copilotTokenInfo: authResult.copilotTokenInfo,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to connect to server");
      }

      spinner.succeed("GitHub Copilot connected successfully!");
      console.log(`\nConnected as: ${authResult.userInfo.login}`);
    } catch (error) {
      const { error: showError } = await import("../utils/ui");
      showError(`GitHub connection failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
