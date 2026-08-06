// Shared embedding helpers
export function bearerAuth(creds: any) {
  return { Authorization: `Bearer ${creds.apiKey || creds.accessToken}` };
}
