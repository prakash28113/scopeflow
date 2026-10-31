import type { Metadata } from "next";
import { Logo } from "@/components/ui";
import { requireUser } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ settings?: string }> }) {
  const { profile } = await requireUser({ onboarded: false });
  const { settings } = await searchParams;
  const isSettings = Boolean(profile.onboarded_at && settings);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Logo className="text-[15px]" />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-6 sm:pt-14">
        <div className="w-full max-w-[420px]">
          <p className="text-[13px] font-medium text-accent">{isSettings ? "Settings" : "Step 1 of 2"}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            {isSettings ? "Workspace settings" : "Set up your workspace"}
          </h1>
          <p className="mb-8 mt-1.5 text-sm text-muted">
            {isSettings
              ? "These details appear on client approval pages and emails."
              : "Two quick details, then you'll create your first project."}
          </p>
          <OnboardingForm
            mode={isSettings ? "settings" : "onboarding"}
            defaults={{
              fullName: profile.full_name ?? "",
              businessName: profile.business_name ?? "",
              currency: profile.default_currency,
            }}
          />
        </div>
      </main>
    </div>
  );
}
