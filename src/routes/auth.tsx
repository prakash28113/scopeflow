import { LogoFull } from "@/components/brand";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Alert, Field, Input, Logo } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { Captcha, captchaSiteKey } from "@/components/captcha";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/lib/safe-redirect";
import { PASSWORD_RESET_EMAIL, SUPPORT_EMAIL, supportMailto } from "@/lib/site";
import { BetaBadge } from "@/components/site-footer";
import { issuesToFieldErrors, newPasswordSchema, resetRequestSchema, signInSchema, signUpSchema, type FieldErrors } from "@/lib/validation";
import { readRecoveryHash } from "@/lib/recovery";
import { GoogleSignIn } from "@/components/google-signin";

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      {/* Brand panel (wide screens): what ScopeFlow keeps on record. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-chrome p-10 text-white lg:flex xl:p-14">
        <Link to="/" aria-label="ScopeFlow home" className="inline-flex items-center gap-2">
          <LogoFull tone="white" className="h-[26px] w-auto" />
          <span className="rounded-full bg-chrome-2 px-2 py-0.5 text-[11px] font-medium leading-none text-chrome-text ring-1 ring-chrome-line">Beta</span>
        </Link>
        <div className="max-w-md">
          <p className="display text-[40px] font-semibold leading-[1.05] xl:text-[46px]">Every client job, on the record.</p>
          <ul className="mt-8 space-y-4 text-[15px] text-chrome-text">
            {[
              "The scope your client approved, locked with a fingerprint",
              "Every request checked against it, even ones from WhatsApp",
              "Change orders, GST invoices with UPI, and what you earned",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <svg width="18" height="18" viewBox="0 0 16 16" className="mt-[3px] shrink-0 text-accent-line" aria-hidden>
                  <path d="M3.8 8.4 6.7 11.2 12.3 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-chrome-muted">Free for 2 active projects. Your clients never need an account.</p>
      </aside>
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center gap-2 px-6 py-5 lg:invisible">
          <Link to="/" aria-label="ScopeFlow home">
            <Logo className="text-[15px]" />
          </Link>
          <BetaBadge />
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-12 lg:items-center lg:pt-0">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function useAuthForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [captcha, setCaptcha] = useState<string | null>(null);
  return {
    pending,
    setPending,
    error,
    setError,
    fieldErrors,
    setFieldErrors,
    captcha,
    setCaptcha,
  };
}

export function LoginPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const f = useAuthForm();
  const next = safeNext(params.get("next"));
  if (session) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return f.setFieldErrors(issuesToFieldErrors(parsed.error));
    if (captchaSiteKey && !f.captcha) return f.setError("Please complete the security check.");
    f.setFieldErrors({});
    f.setError(null);
    f.setPending(true);
    const { error } = await supabase.auth.signInWithPassword({
      ...parsed.data,
      options: f.captcha ? { captchaToken: f.captcha } : undefined,
    });
    f.setPending(false);
    if (error) return f.setError(error.status === 400 ? "Incorrect email or password." : "Couldn't sign in. Please try again.");
    navigate(next, { replace: true });
  }

  return (
    <AuthLayout>
      <h1 className="display text-[28px] font-semibold leading-tight">Welcome back</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">Sign in to manage your projects.</p>
      <div className="mb-4">
        <GoogleSignIn context="signin" onSignedIn={() => navigate(next, { replace: true })} onError={f.setError} />
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {f.error ? <Alert>{f.error}</Alert> : null}
        <Field label="Email" htmlFor="email" error={f.fieldErrors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" error={f.fieldErrors.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Captcha onToken={f.setCaptcha} />
        <SubmitButton className="w-full" pending={f.pending} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
        <p className="text-[13px] text-muted">
          <Link to="/forgot-password" className="font-medium text-accent hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New to ScopeFlow?{" "}
        <Link to="/signup" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const f = useAuthForm();
  const [notice, setNotice] = useState<string | null>(null);
  if (session) return <Navigate to="/onboarding" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = signUpSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return f.setFieldErrors(issuesToFieldErrors(parsed.error));
    if (captchaSiteKey && !f.captcha) return f.setError("Please complete the security check.");
    f.setFieldErrors({});
    f.setError(null);
    f.setPending(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName },
        captchaToken: f.captcha ?? undefined,
      },
    });
    f.setPending(false);
    if (error) {
      const msg = error.message ?? "";
      if (/already registered|already exists/i.test(msg)) return f.setError("An account with this email already exists.");
      if (/database error saving new user/i.test(msg))
        return f.setError(`Sign-ups are invite-only right now. Email ${SUPPORT_EMAIL} to request access.`);
      if (/password/i.test(msg)) return f.setError(msg);
      return f.setError("Couldn't create the account. Please try again.");
    }
    if (data.session) navigate("/onboarding", { replace: true });
    else setNotice(`Your account was created but needs activation before you can sign in. Please email ${SUPPORT_EMAIL}.`);
  }

  return (
    <AuthLayout>
      <h1 className="display text-[28px] font-semibold leading-tight">Create your account</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">Start free. No card needed.</p>
      {notice ? (
        <Alert tone="info">{notice}</Alert>
      ) : (
        <>
          <div className="mb-4">
            <GoogleSignIn
              context="signup"
              onSignedIn={() => navigate("/onboarding", { replace: true })}
              onError={f.setError}
              note={
                <>
                  By continuing with Google you agree to the{" "}
                  <Link to="/terms" className="underline hover:text-ink">
                    Terms &amp; Conditions
                  </Link>{" "}
                  and{" "}
                  <Link to="/privacy" className="underline hover:text-ink">
                    Privacy Policy
                  </Link>
                  .
                </>
              }
            />
          </div>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {f.error ? <Alert>{f.error}</Alert> : null}
            <Field label="Your name" htmlFor="fullName" error={f.fieldErrors.fullName}>
              <Input id="fullName" name="fullName" autoComplete="name" required />
            </Field>
            <Field label="Email" htmlFor="email" error={f.fieldErrors.email}>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              error={f.fieldErrors.password}
              hint={
                PASSWORD_RESET_EMAIL
                  ? "At least 8 characters."
                  : "At least 8 characters. Keep it safe: password resets go through support during the beta."
              }
            >
              <Input id="password" name="password" type="password" autoComplete="new-password" required />
            </Field>
            <Captcha onToken={f.setCaptcha} />
            <SubmitButton className="w-full" pending={f.pending} pendingLabel="Creating account…">
              Create account
            </SubmitButton>
            <p className="text-[12px] leading-relaxed text-muted">
              By creating an account you agree to the{" "}
              <Link to="/terms" className="underline hover:text-ink">
                Terms &amp; Conditions
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="underline hover:text-ink">
                Privacy Policy
              </Link>
              .
            </p>
          </form>
        </>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

function SupportReset() {
  return (
    <Alert tone="info">
      Email{" "}
      <a href={supportMailto("Password reset")} className="font-medium underline">
        {SUPPORT_EMAIL}
      </a>{" "}
      from your account email and we&apos;ll help you back in.
    </Alert>
  );
}

export function ForgotPasswordPage() {
  const f = useAuthForm();
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = resetRequestSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return f.setFieldErrors(issuesToFieldErrors(parsed.error));
    if (captchaSiteKey && !f.captcha) return f.setError("Please complete the security check.");
    f.setFieldErrors({});
    f.setError(null);
    f.setPending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken: f.captcha ?? undefined,
    });
    f.setPending(false);
    // Same answer whether or not the account exists, so the form can't be used to probe for accounts.
    if (error && error.status === 429) return f.setError("Too many reset requests. Please wait a few minutes and try again.");
    if (error && error.status !== 400 && error.status !== 422) return f.setError("Couldn't send the email. Please try again.");
    setSent(parsed.data.email);
  }

  return (
    <AuthLayout>
      <h1 className="display text-[28px] font-semibold leading-tight">Reset your password</h1>
      {!PASSWORD_RESET_EMAIL ? (
        <div className="mt-6">
          <SupportReset />
        </div>
      ) : sent ? (
        <div className="mt-6" data-testid="reset-sent">
          <Alert tone="info">
            If an account exists for {sent}, a reset link is on its way. It works once and expires in an hour. Check your spam folder if it
            doesn&apos;t arrive.
          </Alert>
        </div>
      ) : (
        <>
          <p className="mb-8 mt-1.5 text-sm text-muted">
            Enter your account email and we&apos;ll send you a link to choose a new password.
          </p>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {f.error ? <Alert>{f.error}</Alert> : null}
            <Field label="Email" htmlFor="email" error={f.fieldErrors.email}>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Captcha onToken={f.setCaptcha} />
            <SubmitButton className="w-full" pending={f.pending} pendingLabel="Sending…">
              Send reset link
            </SubmitButton>
          </form>
        </>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

type RecoveryState = { status: "checking" } | { status: "ready" } | { status: "invalid"; message: string };

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const f = useAuthForm();
  const [state, setState] = useState<RecoveryState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    const link = readRecoveryHash(window.location.hash);
    // Remove the one-time tokens from the address bar and history straight away.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    (async () => {
      if (link.kind === "error") return setState({ status: "invalid", message: link.message });
      if (link.kind === "tokens") {
        const { error } = await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        });
        if (cancelled) return;
        return setState(
          error
            ? {
                status: "invalid",
                message: "This reset link has expired or was already used.",
              }
            : { status: "ready" },
        );
      }
      setState({
        status: "invalid",
        message: "Open the reset link from your email to choose a new password.",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = newPasswordSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return f.setFieldErrors(issuesToFieldErrors(parsed.error));
    f.setFieldErrors({});
    f.setError(null);
    f.setPending(true);
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    f.setPending(false);
    if (error)
      return f.setError(
        /different from the old/i.test(error.message)
          ? "Choose a password different from your old one."
          : "Couldn't update the password. Request a new link and try again.",
      );
    navigate("/dashboard", { replace: true });
  }

  return (
    <AuthLayout>
      <h1 className="display text-[28px] font-semibold leading-tight">Choose a new password</h1>
      {state.status === "checking" ? (
        <p className="mt-6 text-sm text-muted">Checking your link…</p>
      ) : state.status === "invalid" ? (
        <div className="mt-6 space-y-4">
          <Alert>{state.message}</Alert>
          <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          {f.error ? <Alert>{f.error}</Alert> : null}
          <Field label="New password" htmlFor="password" error={f.fieldErrors.password} hint="At least 8 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Repeat new password" htmlFor="confirm" error={f.fieldErrors.confirm}>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton className="w-full" pending={f.pending} pendingLabel="Saving…">
            Save new password
          </SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
