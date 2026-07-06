import http from "node:http";
import { URL } from "node:url";

/**
 * Start a local HTTP server to receive OAuth callback
 */
export function startLocalServer(
  onCallback: (params: Record<string, string>) => void,
  fixedPort: number | null = null,
): Promise<{ server: http.Server; port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      if (url.pathname === "/callback" || url.pathname === "/auth/callback") {
        const params = Object.fromEntries(url.searchParams);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22c55e; font-size: 3rem; }
    h1 { margin: 1rem 0; }
    p { color: #666; }
    #countdown { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p id="message">Closing in <span id="countdown">3</span> seconds...</p>
  </div>
  <script>
    let count = 3;
    const countdown = document.getElementById("countdown");
    const message = document.getElementById("message");
    const timer = setInterval(() => {
      count--;
      countdown.textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        window.close();
        setTimeout(() => {
          message.textContent = "Please close this tab manually.";
        }, 500);
      }
    }, 1000);
  </script>
</body>
</html>`);

        onCallback(params);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    const portToUse = fixedPort || 0;
    server.listen(portToUse, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        port,
        close: () => server.close(),
      });
    });

    server.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" && fixedPort) {
        reject(
          new Error(
            `Port ${fixedPort} is already in use. Please close other applications using this port.`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}

/* type CallbackWaiter = {
  promise: Promise<Record<string, string>>;
  resolve: (params: Record<string, string>) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}; */

/**
 * Wait for callback with timeout
 */
export function waitForCallback(timeoutMs: number = 300000): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Authentication timeout"));
    }, timeoutMs);
    // Caller wires the resolve into startLocalServer's onCallback.
    (resolve as unknown as { __onCallback?: (p: Record<string, string>) => void }).__onCallback = (
      params,
    ) => {
      clearTimeout(timeout);
      resolve(params);
    };
  });
}

// Singleton proxy server for Codex OAuth callback on fixed port
let codexProxyServer: http.Server | null = null;
let codexProxyTimeout: ReturnType<typeof setTimeout> | null = null;

const CODEX_PROXY_TIMEOUT_MS = 300000;
const CODEX_PORT = 1455;

type CodexSession = {
  codeVerifier: string;
  redirectUri: string;
  status: "pending" | "done" | "error";
  createdAt: number;
  connectionId?: string;
  email?: string;
  error?: string;
};

const pendingExchanges = new Map<string, CodexSession>();

export function registerCodexSession({
  state,
  codeVerifier,
  redirectUri,
}: {
  state: string;
  codeVerifier: string;
  redirectUri: string;
}): boolean {
  if (!state || !codeVerifier || !redirectUri) return false;
  pendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getCodexSessionStatus(state: string): CodexSession | null {
  return pendingExchanges.get(state) || null;
}

export function clearCodexSession(state: string): void {
  pendingExchanges.delete(state);
}

function renderCodexResultPage(success: boolean, message: string): string {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${message}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`;
}

export function startCodexProxy(
  appPort: number,
): Promise<{ success: true } | { success: false; reason: string }> {
  return new Promise((resolve) => {
    if (codexProxyServer) {
      resolve({ success: true });
      return;
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const session = state ? pendingExchanges.get(state) : null;

      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers");
          const { createProviderConnection } = await import("@/models");

          const tokenData = (await exchangeTokens(
            "codex",
            code,
            session.redirectUri,
            session.codeVerifier,
            state ?? undefined,
          )) as {
            accessToken?: string;
            refreshToken?: string;
            expiresIn?: number;
            email?: string;
          };
          const connection = (await createProviderConnection({
            provider: "codex",
            authType: "oauth",
            ...tokenData,
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          })) as { id: string; email?: string };

          session.status = "done";
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(true, "You can close this window."));
        } catch (err) {
          session.status = "error";
          session.error = (err as Error).message;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(false, (err as Error).message));
        } finally {
          stopCodexProxy();
        }
        return;
      }

      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopCodexProxy();
    });

    server.listen(CODEX_PORT, "127.0.0.1", () => {
      codexProxyServer = server;
      codexProxyTimeout = setTimeout(() => stopCodexProxy(), CODEX_PROXY_TIMEOUT_MS);
      resolve({ success: true });
    });

    server.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: (err as Error).message });
      }
    });
  });
}

export function stopCodexProxy(): void {
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyServer) {
    codexProxyServer.close();
    codexProxyServer = null;
  }
}
