import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { decryptToken, encryptToken, generateToken, hashToken } from "@/lib/tokens";

export function portalUrl(token: string) {
  return `${env.appUrl()}/p/${token}`;
}

/** Returns the active client link for a project the current user owns (RLS-scoped). */
export async function getActiveShareUrl(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from("share_links")
    .select("token_ciphertext")
    .eq("project_id", projectId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  try {
    return portalUrl(decryptToken(data.token_ciphertext, env.shareTokenSecret()));
  } catch (e) {
    console.error("[scopeflow] could not decrypt share link — was SHARE_TOKEN_SECRET changed?", e);
    return null;
  }
}

/** Creates a new link, revoking any previous one. Returns the new URL. */
export async function rotateShareLink(supabase: SupabaseClient, projectId: string) {
  const token = generateToken();
  const { error } = await supabase.rpc("rotate_share_link", {
    p_project_id: projectId,
    p_token_hash: hashToken(token),
    p_token_ciphertext: encryptToken(token, env.shareTokenSecret()),
  });
  if (error) return { error, url: null };
  return { error: null, url: portalUrl(token) };
}

export async function ensureShareUrl(supabase: SupabaseClient, projectId: string) {
  const existing = await getActiveShareUrl(supabase, projectId);
  if (existing) return { error: null, url: existing };
  return rotateShareLink(supabase, projectId);
}
