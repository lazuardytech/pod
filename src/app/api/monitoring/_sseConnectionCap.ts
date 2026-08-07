/**
 * Shared SSE connection cap — limits concurrent SSE connections per route.
 *
 * In-memory counter per route path. In a multi-process deployment,
 * limits are NOT enforced globally — each process has its own counter.
 * For cluster deployments, migrate to a shared store (e.g. Redis).
 */

const counters = new Map();

const DEFAULT_MAX_CONCURRENT = 100;

/**
 * Try to acquire an SSE connection slot for the given route path.
 * Returns { allowed: boolean, response: Response | undefined }.
 * If not allowed, response is a 503 Response.
 */
export function tryAcquireSSESlot(routePath: string) {
  const current = counters.get(routePath) || 0;
  if (current >= DEFAULT_MAX_CONCURRENT) {
    return {
      allowed: false,
      response: new Response(
        JSON.stringify({ error: "Too many connections", type: "overload_error" }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "10",
          },
        },
      ),
    };
  }
  counters.set(routePath, current + 1);
  return { allowed: true };
}

/**
 * Release an SSE connection slot for the given route path.
 */
export function releaseSSESlot(routePath: string) {
  const current = counters.get(routePath) || 0;
  if (current <= 1) counters.delete(routePath);
  else counters.set(routePath, current - 1);
}
