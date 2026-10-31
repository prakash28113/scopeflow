import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Supabase's new publishable key (sb_publishable_…) or the legacy anon key. Both are public by design.
const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const configured = Boolean(url && anonKey);

/** Freelancer client: carries the signed-in session. RLS + database functions enforce access. */
export const supabase = createClient(url ?? "http://invalid.localhost", anonKey ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "scopeflow-auth" },
});

/** Client-portal client: never holds a session, so portal calls always run as `anon`. */
export const portalClient = createClient(url ?? "http://invalid.localhost", anonKey ?? "missing", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "scopeflow-portal" },
});
