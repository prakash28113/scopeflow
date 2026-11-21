/**
 * Supabase Management API calls for the backup, release and rollback scripts.
 *
 * - A 401 or 403 is explained in plain words with the exact fix, and is never retried.
 * - Slow or flaky answers (timeouts, network errors, 429, 5xx) are retried a few times, then reported as
 *   "Supabase didn't answer", which is not an authentication problem.
 * - The access token and the response body are never put in an error message: logs of a public repository are public.
 */
export const API = "https://api.supabase.com/v1";
export const TOKEN_HELP =
  "Create a new access token at https://supabase.com/dashboard/account/tokens (an account-level token that can reach the ScopeFlow project, " +
  "so its owner must be a member of the project's organisation), then replace the SUPABASE_ACCESS_TOKEN secret in GitHub: " +
  "repository Settings → Secrets and variables → Actions, and also under Environments → production if a secret of that name exists there " +
  "(an environment secret overrides the repository one). Never paste the token anywhere else.";

export class SupabaseError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "SupabaseError";
    this.code = code; // missing-token | token-invalid | token-forbidden | unavailable | rejected
    this.status = status;
  }
}

/** The error for an HTTP status, or null when the status is a success. Exported for tests. */
export function classify(status, what = "Supabase") {
  if (status >= 200 && status < 300) return null;
  if (status === 401)
    return new SupabaseError("token-invalid", `${what} rejected SUPABASE_ACCESS_TOKEN (401): the token is expired, revoked or mistyped. ${TOKEN_HELP}`, 401);
  if (status === 403)
    return new SupabaseError("token-forbidden", `${what} refused SUPABASE_ACCESS_TOKEN (403): the token is valid but has no access to this project or this action. ${TOKEN_HELP}`, 403);
  if (status === 429 || status >= 500) return new SupabaseError("unavailable", `${what} is busy or down (${status}). Try again in a few minutes.`, status);
  return new SupabaseError("rejected", `${what} rejected the request (${status}).`, status);
}

const transient = (e) => e instanceof SupabaseError && e.code === "unavailable";

/**
 * Runs one SQL statement (or several, in one transaction) through the project's database query endpoint.
 * Returns the parsed JSON rows.
 */
export async function supabaseQuery({ token, ref, query, readOnly = false, fetch = globalThis.fetch, retries = 3, timeoutMs = 60_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!token) throw new SupabaseError("missing-token", `SUPABASE_ACCESS_TOKEN is not available to this workflow. ${TOKEN_HELP}`);
  if (!/^[a-z0-9]{20}$/.test(ref ?? "")) throw new SupabaseError("rejected", "Unexpected Supabase project reference.");
  for (let attempt = 1; ; attempt++) {
    try {
      let res;
      try {
        res = await fetch(`${API}/projects/${ref}/database/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new SupabaseError("unavailable", "Supabase didn't answer (network error or timeout).", 0);
      }
      const err = classify(res.status);
      if (err) throw err;
      return await res.json();
    } catch (e) {
      if (!transient(e) || attempt >= retries) throw e;
      await sleep(attempt * 5000);
    }
  }
}

/** A harmless read-only query that proves the token works for this project, before any real work starts. */
export async function preflight(opts) {
  await supabaseQuery({ ...opts, query: "select 1 as ok", readOnly: true });
}
