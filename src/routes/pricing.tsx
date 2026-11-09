import { useState } from "react";
import { Link } from "react-router";
import { Alert } from "@/components/ui";
import { BetaBadge, SiteFooter } from "@/components/site-footer";
import { FeatureMatrix, IntervalToggle, PlanCards } from "@/components/plans";
import { PageSpinner } from "@/components/app-shell";
import { useMyPlan, usePlans, type Interval } from "@/lib/plans";
import { soloCta } from "@/lib/plan-intent";
import { useAuth } from "@/lib/auth";
import { PRICING_FAQ as FAQ } from "@/lib/faq";
import { PublicHeader } from "@/components/public-header";
import { anyOnSale } from "@/lib/sale";
import { BILLING_ENABLED } from "@/lib/billing";
import { useSeo } from "@/lib/seo";

export default function PricingPage() {
  useSeo("/pricing");
  const plans = usePlans();
  const { session } = useAuth();
  const [interval, setInterval] = useState<Interval>("month");
  // Signed in: the Solo button goes to Plan & usage (or says which plan they're on), not to sign-up.
  const mine = useMyPlan(Boolean(session));
  const effective = mine.data?.effective_plan;
  const solo = soloCta({ signedIn: Boolean(session), effectivePlan: effective, planName: plans.data?.find((p) => p.id === effective)?.name }, interval);

  return (
    <div className="min-h-dvh">
      <PublicHeader badge={<BetaBadge />} signIn={!session} action={session ? { to: "/plan", label: "Your plan" } : undefined} />
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="mx-auto max-w-2xl pb-10 pt-12 text-center sm:pt-20">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-[46px]">
            Simple pricing. Better client relationships. More profitable projects.
          </h1>
          <p className="mt-4 text-[17px] text-muted">Start free. Upgrade when your freelance business grows.</p>
          <div className="mt-8">
            <IntervalToggle value={interval} onChange={setInterval} />
          </div>
        </section>

        {plans.isLoading ? (
          <PageSpinner />
        ) : plans.isError || !plans.data ? (
          <Alert>Couldn't load plans. Please refresh.</Alert>
        ) : (
          <>
            <PlanCards plans={plans.data} interval={interval} soloLink={solo} />
            <p className="mx-auto mt-6 max-w-2xl text-center text-[13px] text-muted">
              {anyOnSale(plans.data, BILLING_ENABLED)
                ? "Prices in Indian rupees, billed monthly or yearly until you cancel. Payments are handled by Razorpay (UPI, cards, netbanking). Plans marked “Not on sale yet” are in early access."
                : "Prices in Indian rupees. Paid plans are in early access: join the list from your account, and nothing is charged until they launch."}{" "}
              <Link to="/refunds" className="underline hover:text-ink">Refunds and cancellation</Link>.
            </p>
            <h2 className="mb-4 mt-16 text-xl font-semibold tracking-[-0.02em]">Compare plans</h2>
            <FeatureMatrix plans={plans.data} />
          </>
        )}

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="mb-4 text-xl font-semibold tracking-[-0.02em]">Questions</h2>
          <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                  {q}
                  <span className="text-muted transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
