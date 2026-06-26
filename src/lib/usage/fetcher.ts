/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { GITHUB_CONFIG } from "@/lib/oauth/constants/oauth";

type UsageResult = { message: string } | { plan: string; resetDate?: string; quotas: Record<string, GitHubQuota> };

type GitHubQuota = {
  used: number;
  total: number;
  remaining?: number;
  unlimited: boolean;
};

type Connection = {
  provider: string;
  accessToken?: string;
  providerSpecificData?: { copilotToken?: string; resourceUrl?: string };
};

/**
 * Get usage data for a provider connection
 */
export async function getUsageForProvider(connection: Connection): Promise<UsageResult> {
  const { provider, accessToken, providerSpecificData } = connection;

  switch (provider) {
    case "github":
      return await getGitHubUsage(accessToken || "", providerSpecificData);
    case "gemini-cli":
      return await getGeminiUsage(accessToken || "");
    case "antigravity":
      return await getAntigravityUsage(accessToken || "");
    case "claude":
      return await getClaudeUsage(accessToken || "");
    case "codex":
      return await getCodexUsage(accessToken || "");
    case "qwen":
      return await getQwenUsage(accessToken || "", providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken || "");
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}

/**
 * GitHub Copilot Usage
 */
async function getGitHubUsage(
  _accessToken: string,
  providerSpecificData: Connection["providerSpecificData"],
): Promise<UsageResult> {
  try {
    // Use copilotToken for copilot_internal API, not GitHub OAuth accessToken
    const copilotToken = providerSpecificData?.copilotToken;
    if (!copilotToken) {
      throw new Error("Copilot token not found. Please refresh token first.");
    }

    const response = await fetch("https://api.github.com/copilot_internal/user", {
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const data = (await response.json()) as {
      copilot_plan?: string;
      quota_reset_date?: string;
      quota_snapshots?: {
        chat?: { entitlement: number; remaining: number; unlimited?: boolean };
        completions?: { entitlement: number; remaining: number; unlimited?: boolean };
        premium_interactions?: { entitlement: number; remaining: number; unlimited?: boolean };
      };
      monthly_quotas?: { chat?: number; completions?: number };
      limited_user_quotas?: { chat?: number; completions?: number };
      limited_user_reset_date?: string;
      access_type_sku?: string;
    };

    // Handle different response formats (paid vs free)
    if (data.quota_snapshots) {
      // Paid plan format
      const snapshots = data.quota_snapshots;
      return {
        plan: data.copilot_plan || "",
        resetDate: data.quota_reset_date,
        quotas: {
          chat: formatGitHubQuotaSnapshot(snapshots.chat),
          completions: formatGitHubQuotaSnapshot(snapshots.completions),
          premium_interactions: formatGitHubQuotaSnapshot(snapshots.premium_interactions),
        },
      };
    } else if (data.monthly_quotas || data.limited_user_quotas) {
      // Free/limited plan format
      const monthlyQuotas = data.monthly_quotas || {};
      const usedQuotas = data.limited_user_quotas || {};

      return {
        plan: data.copilot_plan || data.access_type_sku || "",
        resetDate: data.limited_user_reset_date,
        quotas: {
          chat: {
            used: usedQuotas.chat || 0,
            total: monthlyQuotas.chat || 0,
            unlimited: false,
          },
          completions: {
            used: usedQuotas.completions || 0,
            total: monthlyQuotas.completions || 0,
            unlimited: false,
          },
        },
      };
    }

    return { message: "GitHub Copilot connected. Unable to parse quota data." };
  } catch (error) {
    throw new Error(`Failed to fetch GitHub usage: ${(error as Error).message}`);
  }
}

function formatGitHubQuotaSnapshot(
  quota: { entitlement: number; remaining: number; unlimited?: boolean } | undefined,
): GitHubQuota {
  if (!quota) return { used: 0, total: 0, unlimited: true };

  return {
    used: quota.entitlement - quota.remaining,
    total: quota.entitlement,
    remaining: quota.remaining,
    unlimited: quota.unlimited || false,
  };
}

/**
 * Gemini CLI Usage (Google Cloud)
 */
async function getGeminiUsage(_accessToken: string): Promise<UsageResult> {
  try {
    // Gemini CLI uses Google Cloud quotas
    // Try to get quota info from Cloud Resource Manager
    const response = await fetch(
      "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE",
      {
        headers: {
          Authorization: `Bearer ${_accessToken}`,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      // Quota API may not be accessible, return generic message
      return { message: "Gemini CLI uses Google Cloud quotas. Check Google Cloud Console for details." };
    }

    return { message: "Gemini CLI connected. Usage tracked via Google Cloud Console." };
  } catch {
    return { message: "Unable to fetch Gemini usage. Check Google Cloud Console." };
  }
}

/**
 * Antigravity Usage
 */
async function getAntigravityUsage(_accessToken: string): Promise<UsageResult> {
  try {
    // Similar to Gemini, uses Google Cloud
    return { message: "Antigravity connected. Usage tracked via Google Cloud Console." };
  } catch {
    return { message: "Unable to fetch Antigravity usage." };
  }
}

/**
 * Claude Usage
 */
async function getClaudeUsage(_accessToken: string): Promise<UsageResult> {
  try {
    // Claude OAuth doesn't expose usage API directly
    // Could potentially check via inference endpoint
    return { message: "Claude connected. Usage tracked per request." };
  } catch {
    return { message: "Unable to fetch Claude usage." };
  }
}

/**
 * Codex (OpenAI) Usage
 */
async function getCodexUsage(_accessToken: string): Promise<UsageResult> {
  try {
    // OpenAI usage requires organization API access
    return { message: "Codex connected. Check OpenAI dashboard for usage." };
  } catch {
    return { message: "Unable to fetch Codex usage." };
  }
}

/**
 * Qwen Usage
 */
async function getQwenUsage(
  _accessToken: string,
  providerSpecificData: Connection["providerSpecificData"],
): Promise<UsageResult> {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }

    // Qwen may have usage endpoint at resource URL
    return { message: "Qwen connected. Usage tracked per request." };
  } catch {
    return { message: "Unable to fetch Qwen usage." };
  }
}

/**
 * iFlow Usage
 */
async function getIflowUsage(_accessToken: string): Promise<UsageResult> {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch {
    return { message: "Unable to fetch iFlow usage." };
  }
}
