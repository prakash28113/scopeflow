import { portalClient } from "./supabase";

export type PortalErrorKind = "invalid_link" | "expired_link" | "rate_limited";
export type PortalError = { code: string; message: string; kind?: PortalErrorKind };

/**
 * Calls a public portal function. Link and rate-limit problems come back as
 * { error, message } in the result (so the database can commit its abuse
 * counters); this turns them into an ordinary error for the UI.
 */
export async function portalRpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: PortalError | null }> {
  const { data, error } = await portalClient.rpc(fn, args);
  if (error) return { data: null, error: { code: error.code ?? "", message: error.message } };
  if (data && typeof data === "object" && "error" in data) {
    const d = data as { error: PortalErrorKind; message: string };
    // Codes chosen so userMessage() shows the database's message as-is.
    return { data: null, error: { code: d.error === "rate_limited" ? "55000" : "28000", message: d.message, kind: d.error } };
  }
  return { data: data as T, error: null };
}
