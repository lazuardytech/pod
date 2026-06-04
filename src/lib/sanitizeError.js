// Production-safe error message helper.
// Prevents internal error details (stack traces, paths, etc.) from leaking to clients.

export function sanitizeError(error) {
  if (process.env.NODE_ENV !== "production") {
    return error?.message || "Unknown error";
  }
  return "Internal server error";
}
