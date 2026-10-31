"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";
import { issuesToFieldErrors, signInSchema, signUpSchema, type ActionState } from "@/lib/validation";

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${env.appUrl()}/auth/callback?next=/onboarding`,
    },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/onboarding");
  return { ok: true, message: `We sent a confirmation link to ${parsed.data.email}. Open it to finish creating your account.` };
}

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error: error.code === "email_not_confirmed" ? "Please confirm your email first." : "Incorrect email or password.",
    };
  }
  redirect(safeNext(form.get("next")));
}

export async function requestPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ email: z.email("Enter a valid email") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.appUrl()}/auth/callback?next=/reset-password`,
  });
  // Same response whether or not the account exists.
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ password: z.string().min(8, "Use at least 8 characters").max(72) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Your reset link has expired. Request a new one." };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
