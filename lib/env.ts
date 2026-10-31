/**
 * Environment access. Values are read lazily so `next build` does not need
 * production secrets; a missing required value fails loudly at request time.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () =>
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseServiceRoleKey: () =>
    required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
  appUrl: () => required("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, ""),
  shareTokenSecret: () => required("SHARE_TOKEN_SECRET", process.env.SHARE_TOKEN_SECRET),
  /** Optional: when absent, emails are logged as "skipped" instead of sent. */
  resendApiKey: () => process.env.RESEND_API_KEY || null,
  emailFrom: () => process.env.EMAIL_FROM || "ScopeFlow <onboarding@resend.dev>",
};
