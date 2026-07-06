// todo(ts): `getServerCredentials` was previously imported from this path
// in src/lib/oauth/services/*.js, but the actual implementation was never
// committed to the repo. The CLI OAuth flows relying on it are not in the
// runtime path for the Next.js dashboard. Provide a minimal stub that
// reads from env vars so the type check passes; runtime callers should
// override via POD_CLI_SERVER / POD_CLI_TOKEN / POD_CLI_USER_ID env vars.

export type ServerCredentials = {
  server: string;
  token: string;
  userId: string;
};

export function getServerCredentials(): ServerCredentials {
  return {
    server: process.env.POD_CLI_SERVER ?? "http://localhost:20128",
    token: process.env.POD_CLI_TOKEN ?? "",
    userId: process.env.POD_CLI_USER_ID ?? "",
  };
}
