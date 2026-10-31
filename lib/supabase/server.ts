import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";

/** Per-request client acting as the signed-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** Anonymous client with no session — used for token-gated portal RPCs. */
export function createPublicClient() {
  return createPlainClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client. Bypasses RLS — only used server-side for
 * notification lookups and the email log. Never pass user input as a filter
 * without first authorising the request.
 */
export function createAdminClient() {
  return createPlainClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  business_name: string | null;
  default_currency: string;
  onboarded_at: string | null;
};

/** Server-side auth gate. Validates the JWT with Supabase (getUser, not getSession). */
export async function requireUser(opts: { onboarded?: boolean } = { onboarded: true }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, business_name, default_currency, onboarded_at")
    .eq("id", user.id)
    .single<Profile>();
  if (!profile) redirect("/login");
  if (opts.onboarded !== false && !profile.onboarded_at) redirect("/onboarding");
  return { supabase, user, profile };
}
