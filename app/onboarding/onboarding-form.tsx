"use client";

import { useActionState } from "react";
import { Alert, Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { CURRENCIES } from "@/lib/money";
import type { ActionState } from "@/lib/validation";
import { completeOnboarding } from "./actions";

export function OnboardingForm({
  defaults,
  mode,
}: {
  defaults: { fullName: string; businessName: string; currency: string };
  mode: "onboarding" | "settings";
}) {
  const [state, action] = useActionState(completeOnboarding, {} as ActionState);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <input type="hidden" name="returnTo" value={mode} />
      <Field label="Your name" htmlFor="fullName" error={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" defaultValue={defaults.fullName} autoComplete="name" />
      </Field>
      <Field
        label="Business or studio name"
        htmlFor="businessName"
        error={state.fieldErrors?.businessName}
        hint="Optional. Clients see this on their approval page and in emails."
      >
        <Input id="businessName" name="businessName" defaultValue={defaults.businessName} autoComplete="organization" />
      </Field>
      <Field label="Default currency" htmlFor="currency" error={state.fieldErrors?.currency} hint="You can change it per project.">
        <Select id="currency" name="currency" defaultValue={defaults.currency}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton className="w-full" pendingLabel="Saving…">
        {mode === "onboarding" ? "Continue" : "Save settings"}
      </SubmitButton>
    </form>
  );
}
