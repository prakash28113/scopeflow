"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { userMessage } from "@/lib/errors";
import { issuesToFieldErrors, onboardingSchema, type ActionState } from "@/lib/validation";

export async function completeOnboarding(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireUser({ onboarded: false });
  const parsed = onboardingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };
  const { error } = await supabase.rpc("complete_onboarding", {
    p_full_name: parsed.data.fullName,
    p_business_name: parsed.data.businessName,
    p_currency: parsed.data.currency,
  });
  if (error) return { error: userMessage(error) };
  redirect(form.get("returnTo") === "settings" ? "/dashboard" : "/projects/new?welcome=1");
}
