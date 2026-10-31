/** Only allow same-site relative paths, to prevent open redirects. */
export function safeNext(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
