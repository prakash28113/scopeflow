/**
 * Turns database errors into messages that are safe to show users.
 * Only errors raised deliberately by our SQL functions (with known codes)
 * pass their text through; anything else is logged and replaced.
 */
type DbError = { code?: string; message?: string } | null | undefined;

const USER_FACING_CODES = new Set(["22023", "55000", "28000", "P0002"]);

export function userMessage(error: DbError, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  if (error.code && USER_FACING_CODES.has(error.code) && error.message) return error.message;
  if (error.code === "23514") return "Some of the values are not valid. Please check the form.";
  if (error.code === "23505") return "This has already been recorded.";
  if (error.code === "42501") return "You don't have permission to do that.";
  console.error("[scopeflow] unexpected database error", error);
  return fallback;
}
