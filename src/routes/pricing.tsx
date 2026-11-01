import { useState } from "react";
import { Link } from "react-router";
import { Alert, Logo, buttonClass } from "@/components/ui";
import { BetaBadge, SiteFooter } from "@/components/site-footer";
import { FeatureMatrix, IntervalToggle, PlanCards } from "@/components/plans";
import { PageSpinner } from "@/components/app-shell";
import { usePlans, type Interval } from "@/lib/plans";
import { useAuth } from "@/lib/auth";

const FAQ: [string, string][] = [
  ["Can I use ScopeFlow for free?", "Yes. The Free plan includes 2 active projects and 5 clients with every core feature: scope agreements, client approvals, revision tracking, change orders, quotes, invoices and payment tracking. Expenses and analytics are free for everyone during the beta. Completed and cancelled projects don't count toward the limit."],
  ["Can I change plans later?", "Yes. When paid plans launch you can upgrade, downgrade or cancel at any time from Plan & usage."],
  ["What happens to my projects if I downgrade?", "Nothing is deleted or locked. Every project, approval and client link keeps working. You just can't start new projects beyond the lower plan's limit."],
  ["Can clients approve projects without an account?", "Yes, on every plan. Clients open a private link, review the scope and approve — no sign-up."],
  ["Can I cancel anytime?", "Yes. Paid features stay on until the end of the period you paid for, then the account moves to Free with all data intact."],
  ["Are payments processed securely?", "Paid plans aren't on sale yet, and ScopeFlow has never taken a payment. When they launch, a certified payment provider will handle cards; ScopeFlow never sees or stores card details."],
];

export default function PricingPage() {
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
              Prices in US dollars. Paid plans are in early access: join the list from your account, and nothing is charged until they launch.
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
