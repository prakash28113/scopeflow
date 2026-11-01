import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Alert, Field, Input, Logo } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { Captcha, captchaSiteKey } from "@/components/captcha";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/lib/safe-redirect";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/site";
import { BetaBadge } from "@/components/site-footer";
import { issuesToFieldErrors, signInSchema, signUpSchema, type FieldErrors } from "@/lib/validation";

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 px-6 py-5">
        <Link to="/" aria-label="ScopeFlow home">
          <Logo className="text-[15px]" />
        </Link>
        <BetaBadge />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}

function useAuthForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [captcha, setCaptcha] = useState<string | null>(null);
  return { pending, setPending, error, setError, fieldErrors, setFieldErrors, captcha, setCaptcha };
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
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Welcome back</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">Sign in to manage your projects.</p>
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
          Forgot your password? Email{" "}
          <a href={supportMailto("Password reset")} className="font-medium text-accent hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          from your account email and we&apos;ll help you back in.
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
      options: { data: { full_name: parsed.data.fullName }, captchaToken: f.captcha ?? undefined },
    });
    f.setPending(false);
    if (error) {
      const msg = error.message ?? "";
      if (/already registered|already exists/i.test(msg)) return f.setError("An account with this email already exists.");
      if (/database error saving new user/i.test(msg)) return f.setError(`Sign-ups are invite-only right now. Email ${SUPPORT_EMAIL} to request access.`);
      if (/password/i.test(msg)) return f.setError(msg);
      return f.setError("Couldn't create the account. Please try again.");
    }
    if (data.session) navigate("/onboarding", { replace: true });
    else setNotice(`Your account was created but needs activation before you can sign in. Please email ${SUPPORT_EMAIL}.`);
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Create your account</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">Free during the beta. No card needed.</p>
      {notice ? (
        <Alert tone="info">{notice}</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {f.error ? <Alert>{f.error}</Alert> : null}
          <Field label="Your name" htmlFor="fullName" error={f.fieldErrors.fullName}>
            <Input id="fullName" name="fullName" autoComplete="name" required />
          </Field>
          <Field label="Email" htmlFor="email" error={f.fieldErrors.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password" error={f.fieldErrors.password} hint="At least 8 characters. There's no email reset during the beta, so keep it safe.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Captcha onToken={f.setCaptcha} />
          <SubmitButton className="w-full" pending={f.pending} pendingLabel="Creating account…">
            Create account
          </SubmitButton>
          <p className="text-[12px] leading-relaxed text-muted">
            By creating an account you agree to the{" "}
            <Link to="/terms" className="underline hover:text-ink">Terms</Link> and{" "}
            <Link to="/privacy" className="underline hover:text-ink">Privacy Policy</Link>.
          </p>
        </form>
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
