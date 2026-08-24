import { NextResponse } from "next/server";
import {
  DEFAULT_HEADROOM_URL,
  isLoopbackHeadroomUrl,
  resolveHeadroomPort,
} from "@/lib/headroom/detect.ts";
import { getSettings } from "@/lib/localDb";
import { checkDashboardApiAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DASHBOARD_PREFIX = "/api/headroom/proxy";

async function getTargetBase(): Promise<URL> {
  const settings = await getSettings();
  const url = String(settings.headroomUrl || DEFAULT_HEADROOM_URL);
  if (!isLoopbackHeadroomUrl(url)) {
    throw Object.assign(new Error("Headroom proxy is loopback-only"), { code: "EXTERNAL_PROXY" });
  }
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Headroom URL must use http or https");
  }
  target.port = String(resolveHeadroomPort(url));
  return target;
}

function buildTargetUrl(base: URL, path: string[], search: string): URL {
  const target = new URL(base);
  target.pathname = `/${path.join("/")}`;
  target.search = search;
  return target;
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const header of headers.keys()) {
    if (HOP_BY_HOP_HEADERS.has(header.toLowerCase())) headers.delete(header);
  }
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("x-9r-cli-token");
  return headers;
}

function rewriteDashboardHtml(html: string): string {
  return html.replace(
    /fetch\('(?=\/(?:stats|health|stats-history|transformations\/feed))/g,
    `fetch('${DASHBOARD_PREFIX}`,
  );
}

async function proxy(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const base = await getTargetBase();
    const { search } = new URL(request.url);
    const path = (await context.params).path || [];
    const target = buildTargetUrl(base, path, search);
    const method = request.method;
    const hasBody = !["GET", "HEAD"].includes(method);

    const response = await fetch(target, {
      method,
      headers: forwardedHeaders(request),
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);

    const headers = new Headers(response.headers);
    for (const header of headers.keys()) {
      if (HOP_BY_HOP_HEADERS.has(header.toLowerCase())) headers.delete(header);
    }
    headers.delete("set-cookie");

    if (path.join("/") === "dashboard") {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        headers.delete("content-length");
        return new NextResponse(rewriteDashboardHtml(await response.text()), {
          status: response.status,
          headers,
        });
      }
    }

    return new NextResponse(response.body, { status: response.status, headers });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
    return NextResponse.json(
      { error: sanitizeError(error), code },
      { status: code === "EXTERNAL_PROXY" ? 403 : 500 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
