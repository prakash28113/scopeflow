/**
 * What the sign-up, sign-in and resend forms do with Supabase's answers. Pure, so the rules are
 * tested without a browser (tests/unit/auth-flow.test.ts).
 *
 * The forms work in every combination of Supabase settings:
 *  - "Confirm email" off: signUp returns a session and the person goes straight to set-up.
 *  - "Confirm email" on: signUp returns no session; the person sees "Check your inbox".
 *  - An address that already has an account gets the SAME "Check your inbox" screen, so the form
 *    can't be used to find out who has an account.
 *  - CAPTCHA (Cloudflare Turnstile) on or off: a token is sent only when the widget produced one.
 */
type AuthErrorLike = { message?: string | null; status?: number | null; code?: string | null } | null | undefined;

export type SignUpOutcome = { kind: "signed-in" } | { kind: "check-inbox" } | { kind: "error"; message: string };

export const CAPTCHA_FAILED = "Please complete the check and try again.";
/** Seconds before "Resend" can be used (again). */
export const RESEND_WAIT_S = 60;

export const isCaptchaError = (e: AuthErrorLike) => Boolean(e) && (e!.code === "captcha_failed" || /captcha/i.test(e!.message ?? ""));
const isRateLimit = (e: AuthErrorLike) => Boolean(e) && (e!.status === 429 || /rate limit|too many/i.test(e!.message ?? ""));

export function signUpOutcome(data: { session?: unknown } | null | undefined, error: AuthErrorLike, supportEmail: string): SignUpOutcome {
  if (error) {
    const msg = error.message ?? "";
    if (isCaptchaError(error)) return { kind: "error", message: CAPTCHA_FAILED };
    // Same screen as a new address: never reveal that an account exists.
    if (error.code === "user_already_exists" || error.code === "email_exists" || /already registered|already exists|already been registered/i.test(msg)) return { kind: "check-inbox" };
    if (isRateLimit(error)) return { kind: "error", message: "Too many attempts. Please wait a minute and try again." };
    if (/database error saving new user/i.test(msg)) return { kind: "error", message: `Sign-ups are invite-only right now. Email ${supportEmail} to request access.` };
    if (error.code === "weak_password" || /password/i.test(msg)) return { kind: "error", message: msg || "Choose a stronger password." };
    return { kind: "error", message: "Couldn't create the account. Please try again." };
  }
  return data?.session ? { kind: "signed-in" } : { kind: "check-inbox" };
}

/** One generic answer for a wrong email or password, whoever the account belongs to. */
export function signInError(error: AuthErrorLike): string | null {
  if (!error) return null;
  if (isCaptchaError(error)) return CAPTCHA_FAILED;
  if (isRateLimit(error)) return "Too many attempts. Please wait a minute and try again.";
  // Supabase says this only when the password was right, so it gives nothing away.
  if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message ?? ""))
    return "Confirm your email first: open the link we sent you (check spam too). To get a new link, sign up again with the same email.";
  return error.status === 400 ? WRONG_PASSWORD : "Couldn't sign in. Please try again.";
}

export const WRONG_PASSWORD = "Incorrect email or password.";
/** Shown under a wrong-password error for everyone, so it says nothing about any one address. */
export const GOOGLE_HINT = "Signed up with Google? Use 'Continue with Google' above.";

/** Resend never says whether the address has an account either. */
export function resendError(error: AuthErrorLike): string | null {
  if (!error) return null;
  if (isCaptchaError(error)) return CAPTCHA_FAILED;
  if (isRateLimit(error)) return "Please wait a minute before asking for another email.";
  return null;
}

/** The CAPTCHA part of a Supabase auth call: nothing at all when there's no token. */
export function captchaOptions(token: string | null | undefined): { captchaToken?: string } {
  return token ? { captchaToken: token } : {};
}

/** With a site key configured, a form can be sent only once the widget has produced a token. */
export const captchaBlocks = (siteKey: string | null | undefined, token: string | null | undefined) => Boolean(siteKey) && !token;

/** Where the link in the confirmation email comes back to. */
export function confirmRedirect(origin: string, next = "/onboarding"): string {
  return `${origin.replace(/\/+$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;
}
