import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Alert, Card, CardHeader, Field, Input, Logo, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { PageSpinner } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { useProfile, type Profile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useAction } from "@/lib/use-action";
import { CURRENCIES } from "@/lib/money";
import { UPI_ID } from "@/lib/upi";
import { GSTIN } from "@/lib/invoice";
import { PASSWORD_RESET_EMAIL } from "@/lib/site";
import { issuesToFieldErrors, onboardingSchema, type FieldErrors } from "@/lib/validation";

function WorkspaceForm({ profile, onDone, submitLabel }: { profile: Profile; onDone: () => void; submitLabel: string }) {
  const qc = useQueryClient();
  const action = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await action.run(onboardingSchema, Object.fromEntries(new FormData(e.currentTarget)), (d) =>
      supabase.rpc("complete_onboarding", { p_full_name: d.fullName, p_business_name: d.businessName, p_currency: d.currency }).then((r) => ({ data: true, error: r.error })),
    );
    if (ok) {
      await qc.invalidateQueries({ queryKey: ["profile"] });
      onDone();
    }
  }
  const fe = action.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {action.error ? <Alert>{action.error}</Alert> : null}
      <Field label="Your name" htmlFor="fullName" error={fe.fullName}>
        <Input id="fullName" name="fullName" defaultValue={profile.full_name ?? ""} autoComplete="name" />
      </Field>
      <Field label="Business or studio name" htmlFor="businessName" error={fe.businessName} hint="Optional. Clients see this on their project page.">
        <Input id="businessName" name="businessName" defaultValue={profile.business_name ?? ""} autoComplete="organization" />
      </Field>
      <Field label="Default currency" htmlFor="currency" error={fe.currency} hint="You can change it per project.">
        <Select id="currency" name="currency" defaultValue={profile.default_currency}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <SubmitButton className="w-full sm:w-auto" pending={action.pending}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

export function OnboardingPage() {
  const profile = useProfile();
  const navigate = useNavigate();
  if (!profile.data) return <PageSpinner />;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Logo className="text-[15px]" />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-6 sm:pt-14">
        <div className="w-full max-w-[420px]">
          <p className="text-[13px] font-medium text-accent">Step 1 of 2</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Set up your workspace</h1>
          <p className="mb-8 mt-1.5 text-sm text-muted">Two quick details, then you'll create your first project.</p>
          <WorkspaceForm profile={profile.data} submitLabel="Continue" onDone={() => navigate("/projects/new?welcome=1", { replace: true })} />
        </div>
      </main>
    </div>
  );
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "Use at least 8 characters").max(72, "Use 72 characters or fewer"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

function PasswordForm({ email }: { email: string }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<FieldErrors>({});
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = passwordSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) return setFe(issuesToFieldErrors(parsed.error));
    setFe({});
    setError(null);
    setPending(true);
    // Re-verify the current password so a borrowed session can't change it.
    const check = await supabase.auth.signInWithPassword({ email, password: parsed.data.current });
    if (check.error) {
      setPending(false);
      return setFe({ current: "That isn't your current password" });
    }
    const { error } = await supabase.auth.updateUser({ password: parsed.data.next });
    setPending(false);
    if (error) return setError(error.message || "Couldn't change the password.");
    form.reset();
    toast("positive", "Password changed.");
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Current password" htmlFor="current" error={fe.current}>
        <Input id="current" name="current" type="password" autoComplete="current-password" />
      </Field>
      <Field label="New password" htmlFor="next" error={fe.next}>
        <Input id="next" name="next" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={fe.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <SubmitButton variant="secondary" pending={pending}>
        Change password
      </SubmitButton>
    </form>
  );
}

function UpiForm({ current }: { current: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const action = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await action.run(upiSchema, Object.fromEntries(new FormData(e.currentTarget)), (d) =>
      supabase.rpc("set_payment_details", { p_upi_id: d.upiId }).then((r) => ({ data: true, error: r.error })),
    );
    if (!ok) return;
    await qc.invalidateQueries({ queryKey: ["profile"] });
    toast("positive", "Payment details saved.");
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {action.error ? <Alert>{action.error}</Alert> : null}
      <Field label="UPI ID" htmlFor="upiId" error={action.fieldErrors.upiId} hint="Like yourname@okicici. Leave empty to hide the UPI button. Payments go straight to you; ScopeFlow never handles money.">
        <Input id="upiId" name="upiId" defaultValue={current} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="yourname@okicici" />
      </Field>
      <SubmitButton variant="secondary" pending={action.pending}>
        Save payment details
      </SubmitButton>
    </form>
  );
}

const invoiceSchema = z.object({
  businessAddress: z.string().trim().max(500, "Keep the address under 500 characters"),
  gstin: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .refine((v) => v === "" || GSTIN.test(v), "Enter a valid 15-character GSTIN, like 36ABCDE1234F1Z5"),
  invoicePrefix: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === "" || /^[A-Z0-9]{1,8}$/.test(v), "Use up to 8 letters or numbers"),
});

function InvoiceDetailsForm({ address, gstin, prefix }: { address: string; gstin: string; prefix: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const action = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await action.run(invoiceSchema, Object.fromEntries(new FormData(e.currentTarget)), (d) =>
      supabase
        .rpc("set_invoice_details", { p: { business_address: d.businessAddress, gstin: d.gstin, invoice_prefix: d.invoicePrefix } })
        .then((r) => ({ data: true, error: r.error })),
    );
    if (!ok) return;
    await qc.invalidateQueries({ queryKey: ["profile"] });
    toast("positive", "Invoice details saved.");
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {action.error ? <Alert>{action.error}</Alert> : null}
      <Field label="Business address" htmlFor="businessAddress" error={action.fieldErrors.businessAddress} hint="Street, city, PIN code. Leave empty if you don't want it on invoices.">
        <Textarea id="businessAddress" name="businessAddress" rows={3} defaultValue={address} maxLength={500} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="GSTIN (optional)" htmlFor="gstin" error={action.fieldErrors.gstin} hint="Add it if you're GST-registered. Invoices with GST then say “Tax invoice”.">
          <Input id="gstin" name="gstin" defaultValue={gstin} autoCapitalize="characters" spellCheck={false} placeholder="36ABCDE1234F1Z5" />
        </Field>
        <Field label="Invoice number prefix" htmlFor="invoicePrefix" error={action.fieldErrors.invoicePrefix} hint={`Invoices are numbered ${prefix || "INV"}-${new Date().getFullYear()}-001, -002…`}>
          <Input id="invoicePrefix" name="invoicePrefix" defaultValue={prefix} autoCapitalize="characters" maxLength={8} />
        </Field>
      </div>
      <SubmitButton variant="secondary" pending={action.pending}>
        Save invoice details
      </SubmitButton>
    </form>
  );
}

const upiSchema = z.object({
  upiId: z.string().trim().refine((v) => v === "" || UPI_ID.test(v), "Enter a UPI ID like yourname@okicici"),
});

export function SettingsPage() {
  const profile = useProfile();
  const toast = useToast();
  if (!profile.data) return <PageSpinner />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description={profile.data.email} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Workspace" description="Shown to clients on their project page." />
          <div className="p-5">
            <WorkspaceForm profile={profile.data} submitLabel="Save" onDone={() => toast("positive", "Settings saved.")} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Getting paid" description="For projects in Indian rupees, clients see a “Pay via UPI” button and QR code on each unpaid milestone." />
          <div className="p-5">
            <UpiForm current={profile.data.upi_id ?? ""} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Invoice details" description="Shown on every invoice you create. Changing them later never alters invoices you've already issued." />
          <div className="p-5">
            <InvoiceDetailsForm
              address={profile.data.business_address ?? ""}
              gstin={profile.data.gstin ?? ""}
              prefix={profile.data.invoice_prefix ?? "INV"}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Password" description={PASSWORD_RESET_EMAIL ? "Change the password you sign in with." : "Password resets go through support during the beta, so keep this somewhere safe."} />
          <div className="p-5">
            <PasswordForm email={profile.data.email} />
          </div>
        </Card>
      </div>
    </div>
  );
}
