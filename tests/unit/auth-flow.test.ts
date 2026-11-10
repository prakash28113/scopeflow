import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CAPTCHA_FAILED, RESEND_WAIT_S, captchaBlocks, captchaOptions, confirmRedirect, resendError, signInError, signUpOutcome } from "@/lib/auth-flow";
import { readAuthHash } from "@/lib/recovery";
import { buildCsp, TURNSTILE_ORIGIN } from "../../build/security-headers";
import { isKnownPath } from "@/lib/known-routes";

const SUPPORT = "support@scopeflow.in";
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("T1-01 sign-up: works with Confirm email on or off, and never says an account exists", () => {
  it("a session (Confirm email off) goes on to set-up", () => {
    expect(signUpOutcome({ session: { access_token: "x" } }, null, SUPPORT)).toEqual({ kind: "signed-in" });
  });
  it("no session (Confirm email on) shows Check your inbox", () => {
    expect(signUpOutcome({ session: null }, null, SUPPORT)).toEqual({ kind: "check-inbox" });
    expect(signUpOutcome(null, null, SUPPORT)).toEqual({ kind: "check-inbox" });
  });
  it("an existing address gets the identical outcome, whichever way Supabase reports it", () => {
    const fresh = signUpOutcome({ session: null }, null, SUPPORT);
    // Confirm email on: a look-alike user, no error. Confirm email off: an error.
    expect(signUpOutcome({ session: null }, null, SUPPORT)).toEqual(fresh);
    expect(signUpOutcome(null, { message: "User already registered", status: 422, code: "user_already_exists" }, SUPPORT)).toEqual(fresh);
    expect(signUpOutcome(null, { message: "A user with this email address has already been registered", status: 422 }, SUPPORT)).toEqual(fresh);
  });
  it("other errors stay helpful", () => {
    expect(signUpOutcome(null, { code: "captcha_failed", message: "captcha verification process failed", status: 400 }, SUPPORT)).toEqual({ kind: "error", message: CAPTCHA_FAILED });
    expect(signUpOutcome(null, { message: "Database error saving new user", status: 500 }, SUPPORT)).toMatchObject({ kind: "error", message: expect.stringContaining("invite-only") });
    expect(signUpOutcome(null, { message: "Password should be at least 8 characters.", code: "weak_password", status: 422 }, SUPPORT)).toMatchObject({ kind: "error", message: "Password should be at least 8 characters." });
    expect(signUpOutcome(null, { message: "email rate limit exceeded", status: 429 }, SUPPORT)).toMatchObject({ kind: "error", message: expect.stringContaining("wait") });
    expect(signUpOutcome(null, { message: "boom", status: 500 }, SUPPORT)).toEqual({ kind: "error", message: "Couldn't create the account. Please try again." });
  });
  it("no auth screen can say that an account exists", () => {
    for (const f of ["src/routes/auth.tsx", "src/lib/auth-flow.ts", "src/components/google-signin.tsx", "src/components/captcha.tsx"]) {
      // Messages only: comments and the patterns that recognise Supabase's own wording don't count.
      const strings = src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/\/[^/\n]+\/[a-z]*\.test\(/g, "");
      expect(strings, f).not.toMatch(/already exists|already registered|already has an account|account with this email/i);
    }
  });
  it("the confirmation link comes back to /auth/callback on this site, then set-up", () => {
    expect(confirmRedirect("https://scopeflow.in")).toBe("https://scopeflow.in/auth/callback?next=%2Fonboarding");
    expect(confirmRedirect("https://scopeflow.in/", "/onboarding?plan=solo&interval=yearly")).toBe("https://scopeflow.in/auth/callback?next=%2Fonboarding%3Fplan%3Dsolo%26interval%3Dyearly");
    expect(isKnownPath("/auth/callback")).toBe(true);
    expect(src("src/routes/auth.tsx")).toContain("emailRedirectTo: redirectTo");
    expect(src("src/routes/auth.tsx")).toContain('supabase.auth.resend({ type: "signup", email');
    expect(RESEND_WAIT_S).toBe(60);
  });
  it("reads the tokens (or the error) from an emailed link", () => {
    expect(readAuthHash("#access_token=a&refresh_token=r&type=signup")).toEqual({ kind: "tokens", accessToken: "a", refreshToken: "r", type: "signup" });
    expect(readAuthHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toEqual({ kind: "error", expired: true });
    expect(readAuthHash("")).toEqual({ kind: "none" });
    expect(readAuthHash("#access_token=a")).toEqual({ kind: "none" });
  });
});

describe("T1-01 sign-in and resend messages", () => {
  it("wrong email or password: one generic answer", () => {
    expect(signInError({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBe("Incorrect email or password.");
    expect(signInError(null)).toBeNull();
    expect(signInError({ status: 500 })).toBe("Couldn't sign in. Please try again.");
  });
  it("CAPTCHA failures get the friendly line everywhere", () => {
    const e = { status: 400, code: "captcha_failed", message: "captcha verification process failed" };
    expect(signInError(e)).toBe(CAPTCHA_FAILED);
    expect(resendError(e)).toBe(CAPTCHA_FAILED);
    expect(CAPTCHA_FAILED).toBe("Please complete the check and try again.");
  });
  it("an unconfirmed account (right password) is told to open the link", () => {
    expect(signInError({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" })).toMatch(/Confirm your email first/);
  });
  it("resend gives nothing away", () => {
    expect(resendError(null)).toBeNull();
    expect(resendError({ status: 400, message: "anything else" })).toBeNull();
    expect(resendError({ status: 429, message: "rate limit" })).toMatch(/wait/);
  });
});

describe("T1-01 Turnstile: nothing changes until a site key is configured", () => {
  it("without a token nothing is sent; with one it rides along as captchaToken", () => {
    expect(captchaOptions(null)).toEqual({});
    expect(captchaOptions(undefined)).toEqual({});
    expect(captchaOptions("")).toEqual({});
    expect(captchaOptions("tok")).toEqual({ captchaToken: "tok" });
    expect("captchaToken" in { email: "a", ...captchaOptions(null) }).toBe(false);
  });
  it("without a site key no form is blocked; with one, sending waits for a token", () => {
    expect(captchaBlocks(null, null)).toBe(false);
    expect(captchaBlocks("", null)).toBe(false);
    expect(captchaBlocks("1x00000000000000000000AA", null)).toBe(true);
    expect(captchaBlocks("1x00000000000000000000AA", "tok")).toBe(false);
  });
  it("the widget renders only with a site key and is rebuilt after every attempt (tokens work once)", () => {
    const c = src("src/components/captcha.tsx");
    expect(c).toContain("if (!captchaSiteKey) return null;");
    expect(c).toContain("key={attempt}");
    expect(c).toContain("import.meta.env.VITE_TURNSTILE_SITE_KEY");
  });
  it("every password form sends the token and resets the widget; Google sign-in has no CAPTCHA", () => {
    const a = src("src/routes/auth.tsx");
    // sign-in, sign-up, resend, forgot-password
    expect(a).toContain("signInWithPassword({ ...parsed.data, options: captchaOptions(f.captcha) })");
    expect(a).toMatch(/signUp\(\{[\s\S]*?\.\.\.captchaOptions\(f\.captcha\)/);
    expect(a).toMatch(/auth\.resend\(\{[^)]*\.\.\.captchaOptions\(f\.captcha\)/);
    expect(a).toMatch(/resetPasswordForEmail\([\s\S]*?\.\.\.captchaOptions\(f\.captcha\)/);
    expect(a.match(/f\.resetCaptcha\(\);/g)?.length).toBe(4);
    expect(a.match(/disabled=\{f\.blocked\}/g)?.length).toBe(3);
    // Settings → change password re-checks the current password, which needs a token too.
    expect(src("src/routes/settings.tsx")).toContain("options: captchaOptions(captcha)");
    expect(src("src/components/google-signin.tsx")).not.toMatch(/captcha/i);
  });
});

describe("T1-01 CSP: Turnstile adds one origin to three directives and changes nothing else", () => {
  const parse = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
  const opts = { supabaseUrl: "https://abcd.supabase.co", google: true, razorpay: true };
  it("matches the snapshot, directive by directive", () => {
    const off = parse(buildCsp({ ...opts, turnstile: false }));
    const on = parse(buildCsp({ ...opts, turnstile: true }));
    expect(Object.keys(on)).toEqual(Object.keys(off));
    for (const d of Object.keys(off)) {
      if (["script-src", "frame-src", "connect-src"].includes(d)) {
        expect(on[d].filter((v) => !off[d].includes(v)), d).toEqual([TURNSTILE_ORIGIN]);
        expect(off[d].every((v) => on[d].includes(v)), d).toBe(true);
      } else expect(on[d], d).toEqual(off[d]);
    }
    expect(buildCsp({ ...opts, turnstile: true })).toMatchInlineSnapshot(`"default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com https://accounts.google.com/gsi/client https://checkout.razorpay.com https://cdn.razorpay.com; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https://abcd.supabase.co https://*.razorpay.com; font-src 'self'; connect-src 'self' https://abcd.supabase.co https://cloudflareinsights.com https://challenges.cloudflare.com https://accounts.google.com/gsi/ https://api.razorpay.com https://lumberjack.razorpay.com https://checkout.razorpay.com; frame-src https://challenges.cloudflare.com https://accounts.google.com/gsi/ https://api.razorpay.com https://checkout.razorpay.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; manifest-src 'self'"`);
  });
});
