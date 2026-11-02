import { useState } from "react";
import { Link } from "react-router";
import { Alert, Logo, buttonClass } from "@/components/ui";
import { BetaBadge, SiteFooter } from "@/components/site-footer";
import { FeatureMatrix, IntervalToggle, PlanCards } from "@/components/plans";
import { PageSpinner } from "@/components/app-shell";
import { usePlans, type Interval } from "@/lib/plans";
import { useAuth } from "@/lib/auth";
import { PRICING_FAQ as FAQ } from "@/lib/faq";
import { useSeo } from "@/lib/seo";

export default function PricingPage() {
  useSeo("/pricing");
  const plans = usePlans();
  const { session } = useAuth();
  const [interval, setInterval] = useState<Interval>("year");

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="ScopeFlow home" className="flex items-center gap-2">
          <Logo className="text-[15px]" />
          <BetaBadge />
        </Link>
        <nav className="flex items-center gap-2">
          {session ? (
            <Link to="/plan" className={buttonClass("primary", "sm")}>
              Your plan
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonClass("ghost", "sm")}>
                Sign in
              </Link>
              <Link to="/signup" className={buttonClass("primary", "sm")}>
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>
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
            <PlanCards plans={plans.data} interval={interval} />
            <p className="mx-auto mt-6 max-w-2xl text-center text-[13px] text-muted">
              {plans.data.some((p) => p.purchasable)
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
