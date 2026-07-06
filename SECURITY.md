# Security Policy

## Supported Versions

Pod is currently in active development on the `v0.0.x` series. Only the latest release receives security fixes.

| Version           | Supported |
| ----------------- | --------- |
| latest (`v0.0.x`) | ✅        |
| older tags        | ❌        |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via one of these channels:

- **GitHub Security Advisories**: [github.com/lazuardytech/pod/security/advisories/new](https://github.com/lazuardytech/pod/security/advisories/new)
- **Email**: security@lazuardy.tech

Include in your report:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Pod version affected
- Any suggested fix (optional)

We will acknowledge your report within **72 hours** and aim to release a fix within **14 days** for critical issues.

---

## Scope

Issues we consider in scope:

- Authentication and API key bypass
- Privilege escalation in the dashboard
- Injection vulnerabilities (SQL, command, header)
- Sensitive data exposure (API keys, tokens, credentials)
- SSRF via proxy or tunnel configuration
- Denial of service via resource exhaustion

Out of scope:

- Vulnerabilities in upstream providers (OpenAI, Anthropic, etc.)
- Issues requiring physical access to the host
- Self-XSS or issues requiring the attacker to already have admin access
- Rate limiting bypass on self-hosted instances where the operator controls the config

---

## Security Design Notes

These are known design decisions relevant to security:

- **API key auth** is optional and controlled by `settings.requireApiKey`. When disabled, all `/v1/*` endpoints are unauthenticated by design (intended for trusted internal networks).
- **API key comparison** uses timing-safe comparison (`validateApiKey`) to prevent timing attacks.
- **Dashboard auth** is session-based (JWT/cookie) via `dashboardGuard.js`.
- **SQLite** stores API keys, provider credentials, and usage data. The data directory (`DATA_DIR`) should be protected at the OS level.
- **Proxy fetch** supports `HTTPS_PROXY` / `HTTP_PROXY` env vars. Ensure these are set to trusted proxies only.
- **Tailscale and Cloudflare tunnel** integrations expose the dashboard externally. Secure with API key auth and strong credentials when using tunnels.

---

## Disclosure Policy

We follow [responsible disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you:

1. Give us reasonable time to fix the issue before public disclosure.
2. Avoid accessing or modifying data that does not belong to you during testing.
3. Do not perform denial-of-service attacks against production instances.

We will credit reporters in the release notes unless you prefer to remain anonymous.
