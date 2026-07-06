/**
 * Return a production-safe error message. In non-production environments the
 * error's own message is returned for easier debugging; in production a generic
 * "Internal server error" string is returned to avoid leaking internal details
 * (stack traces, file paths, upstream error bodies) to clients.
 */
export function sanitizeError(error: unknown): string {
  if (process.env.NODE_ENV !== "production") {
    if (error instanceof Error) {
      return error.message || "Unknown error";
    }
    if (typeof error === "string") {
      return error;
    }
    return "Unknown error";
  }
  return "Internal server error";
}
