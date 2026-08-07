// Shared embedding helpers
export type EmbeddingCredentials = {
  apiKey?: string;
  accessToken?: string;
  baseUrl?: string;
  providerSpecificData?: { baseUrl?: string };
} | null;

export function bearerAuth(creds: EmbeddingCredentials) {
  return { Authorization: `Bearer ${creds?.apiKey || creds?.accessToken}` };
}
