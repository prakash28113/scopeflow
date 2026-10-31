"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import type { ActionState } from "@/lib/validation";
import { requestPasswordReset, signIn, signUp, updatePassword } from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, {} as ActionState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={state.fieldErrors?.password}
        hint={
          <Link href="/forgot-password" className="text-accent hover:underline">
            Forgot your password?
          </Link>
        }
      >
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUp, {} as ActionState);
  if (state.ok) return <Alert tone="positive">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Field label="Your name" htmlFor="fullName" error={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required />
      </Field>
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password} hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, {} as ActionState);
  if (state.ok) return <Alert tone="positive">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePassword, {} as ActionState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Field label="New password" htmlFor="password" error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Saving…">
        Save password
      </SubmitButton>
    </form>
  );
}
