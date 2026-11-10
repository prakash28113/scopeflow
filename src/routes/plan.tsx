import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { clearIntent, parseIntent } from "@/lib/plan-intent";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Card, CardHeader, PageHeader, Tag } from "@/components/ui";
import { FeatureMatrix, IntervalToggle, PlanCards, UsageMeter } from "@/components/plans";
import { PageSpinner } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { STATUS_TEXT, useInvoices, useMyPlan, usePlans, type Interval, type Plan, type PlanId } from "@/lib/plans";
import { ActionButton } from "@/components/form-bits";
import { BILLING_ENABLED, buyPlan, cancelPlan, preloadCheckout, useBillingStatus } from "@/lib/billing";
import { planSale } from "@/lib/sale";
import { ACTIVATING_TEXT, waitForPaidPlan } from "@/lib/activation";
import { logUsage, takeCheckoutSource } from "@/lib/usage";
import { PRICE_TAX_NOTE } from "@/lib/business";

export default function PlanPage() {
  const plans = usePlans();
  const mine = useMyPlan();
  const invoices = useInvoices();
  const qc = useQueryClient();
  const toast = useToast();
  // Arriving from the pricing page (?plan=solo&interval=…): Solo and the interval are picked for
  // them and shown, but nothing is bought until they press Upgrade.
  const [params] = useSearchParams();
  const intent = parseIntent(params);
  const [interval, setInterval] = useState<Interval>(intent?.interval ?? "month");
  const plansSection = useRef<HTMLElement>(null);
  const [joining, setJoining] = useState<PlanId | null>(null);
  const [buying, setBuying] = useState<PlanId | null>(null);
  const [activating, setActivating] = useState(false);
  const billing = useBillingStatus();
  const ready = !(plans.isLoading || mine.isLoading || (BILLING_ENABLED && billing.isLoading));
  useEffect(() => {
    if (!intent || !ready) return;
    clearIntent(); // used: don't send them here again after a later set-up or sign-in
    const section = plansSection.current;
    if (!section) return;
    section.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    section.querySelector<HTMLElement>(`[data-upgrade="${intent.plan}"]`)?.focus({ preventScroll: true });
    // Once, when the page has its data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // T2-03: have Razorpay's script ready before the click, for accounts that can buy something now.
  const mayBuy = Boolean(
    ready && mine.data?.effective_plan === "free" && billing.data && plans.data?.some((p) => planSale(p, BILLING_ENABLED, billing.data).buyable),
  );
  useEffect(() => {
    if (mayBuy) preloadCheckout();
  }, [mayBuy]);

  // Wait for the billing check too, so a plan never shows "on sale" and "early access" at once.
  if (plans.isLoading || mine.isLoading || (BILLING_ENABLED && billing.isLoading)) return <PageSpinner />;
  if (plans.isError || mine.isError || !plans.data || !mine.data) return <Alert>Couldn't load your plan. Please refresh.</Alert>;
  const m = mine.data;
  const plan = plans.data.find((p) => p.id === m.plan)!;
  const effective = plans.data.find((p) => p.id === m.effective_plan)!;
  const paid = m.plan !== "free";
  // If the billing check failed, nothing is offered for sale on this screen.
  const b = billing.isError ? { enabled: false, mode: null, tester: false } : billing.data;
  const testMode = b?.mode === "test";
  // One answer for every screen (src/lib/sale.ts). The server checks again at checkout.
  const sale = (p: Plan) => planSale(p, BILLING_ENABLED, b ?? { enabled: false, mode: null, tester: false });
  const canBuy = (p: Plan) => effective.id === "free" && sale(p).buyable;
  // A paid subscription renews on a date; a plan without one (complimentary) has nothing to cancel.
  const subscribed = BILLING_ENABLED && paid && (m.status === "active" || m.status === "past_due") && Boolean(m.current_period_end);

  /** After Razorpay confirms, wait (briefly) for the plan to switch on. */
  async function waitForPlan() {
    setActivating(true);
    await waitForPaidPlan(async () => (await qc.fetchQuery({ queryKey: ["my-plan"], staleTime: 0, queryFn: async () => (await supabase.rpc("my_plan")).data }))?.effective_plan);
    setActivating(false);
    await Promise.all([qc.invalidateQueries({ queryKey: ["my-plan"] }), qc.invalidateQueries({ queryKey: ["invoices"] })]);
  }

  async function buy(id: PlanId) {
    setBuying(id);
    try {
      const outcome = await buyPlan(id, interval, () => logUsage("checkout_open", takeCheckoutSource()));
      if (outcome.kind === "paid") {
        toast("positive", ACTIVATING_TEXT);
        await waitForPlan();
        const now = qc.getQueryData<{ effective_plan?: string }>(["my-plan"]);
        toast(now?.effective_plan !== "free" ? "positive" : "info", now?.effective_plan !== "free" ? "Your plan is active. Thank you!" : "Your payment went through. Your plan will switch on within a few minutes.");
      } else if (outcome.kind === "failed") {
        toast("danger", outcome.message);
      }
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Couldn't start the payment. Please try again.");
    } finally {
      setBuying(null);
    }
  }

  async function cancel() {
    try {
      const r = await cancelPlan();
      await qc.invalidateQueries({ queryKey: ["my-plan"] });
      toast("positive", r.at_period_end === false ? "Your plan is cancelled. No more payments will be taken." : "Cancelled. You keep your plan until the end of the period you paid for, and won't be charged again.");
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Couldn't cancel. Please try again.");
    }
  }

  async function join(id: PlanId) {
    setJoining(id);
    const r = await call(() => supabase.rpc("join_early_access", { p_plan: id, p_interval: interval }));
    setJoining(null);
    if (!r.ok) return toast("danger", r.message);
    await qc.invalidateQueries({ queryKey: ["my-plan"] });
    toast("positive", `You're on the early-access list for ${id === "solo" ? "Solo" : "Studio"}. You'll see it here when it's available.`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Plan & usage" description="Your plan, what you're using, and what's coming." />

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader
            title={`${plan.name} plan`}
            action={<Tag tone={m.status === "active" || m.status === "free" ? "positive" : m.status === "past_due" ? "warning" : "neutral"}>{STATUS_TEXT[m.status]}</Tag>}
          />
          <dl className="space-y-2 px-5 py-4 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Billing</dt>
              <dd>{paid && m.billing_interval ? (m.billing_interval === "year" ? "Yearly" : "Monthly") : "No charge"}</dd>
            </div>
            {paid && m.current_period_end ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{m.status === "cancelled" ? "Access until" : "Renews"}</dt>
                <dd>{formatDate(m.current_period_end)}</dd>
              </div>
            ) : null}
            {m.status === "past_due" && m.grace_until ? (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">
                The last payment didn't go through. Razorpay will try again{BILLING_ENABLED ? " and email you a link to update your payment method" : ""}. Paid features stay on until {formatDate(m.grace_until)}; after that the account uses Free limits. Nothing is deleted.
              </p>
            ) : null}
            {m.cancel_at_period_end && m.status === "active" && m.current_period_end ? (
              <p className="rounded-md bg-sunken px-3 py-2 text-ink-2" data-testid="cancelling">
                Cancelled. You keep {plan.name} until {formatDate(m.current_period_end)} and won't be charged again.
              </p>
            ) : null}
            {activating ? (
              <p className="rounded-md bg-accent-soft px-3 py-2 text-accent-hover" role="status" data-testid="activating">
                {ACTIVATING_TEXT}
              </p>
            ) : null}
            {effective.id !== plan.id ? (
              <p className="rounded-md bg-sunken px-3 py-2 text-ink-2">Free plan limits apply right now.</p>
            ) : null}
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[12px] text-muted">
            <p>
              {subscribed
                ? "Cancel anytime: you keep the plan until the end of the period you paid for. Cancelling never deletes projects."
                : paid && m.status === "active" && !m.current_period_end
                  ? "Complimentary plan with no end date. Nothing is charged."
                  : paid
                    ? "Downgrading never deletes projects."
                  : "Free forever. Completed and cancelled projects don't count toward your limit."}
            </p>
            {subscribed && !m.cancel_at_period_end ? (
              <ActionButton
                variant="secondary"
                size="sm"
                onAction={cancel}
                confirm={`Cancel ${plan.name}? You keep it until the end of the period you've paid for, then the account moves to Free limits. Nothing is deleted.`}
                confirmLabel="Cancel plan"
                pendingLabel="Cancelling…"
              >
                Cancel plan
              </ActionButton>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Usage" description={`${effective.name} plan limits`} />
          <div className="space-y-4 px-5 py-4">
            <UsageMeter label="Active projects (incl. drafts)" used={m.usage.active_projects} limit={m.limits.active_projects} />
            <UsageMeter label="Clients" used={m.usage.clients} limit={m.limits.clients} />
            <p className="text-[12px] text-muted">Active = draft, waiting for approval, changes requested, or in progress.</p>
          </div>
        </Card>
      </div>

      <section className="mt-10 scroll-mt-20" ref={plansSection} data-testid="plans-section">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Plans</h2>
            <p className="mt-1 text-[13px] text-muted">
              {b?.enabled && (testMode ? b.tester : plans.data.some((p) => p.purchasable))
                ? `Prices in Indian rupees. Solo: ${PRICE_TAX_NOTE} Payments are handled by Razorpay (UPI, cards, netbanking); ScopeFlow never sees your card or bank details.`
                : "Paid plans are in early access. Joining the list is free and takes no payment details."}
            </p>
            {testMode && b?.tester ? (
              <p className="mt-2 inline-flex rounded-md bg-warning-soft px-2 py-1 text-[12px] font-medium text-warning">Test mode: use Razorpay's test card or UPI. No real money moves.</p>
            ) : null}
          </div>
          <IntervalToggle value={interval} onChange={setInterval} />
        </div>
        {m.early_access ? (
          <div className="mb-5">
            <Alert tone="info">
              You joined early access for {m.early_access.plan === "solo" ? "Solo" : "Studio"} ({m.early_access.billing_interval === "year" ? "yearly" : "monthly"}) on {formatDate(m.early_access.created_at)}.
            </Alert>
          </div>
        ) : null}
        <PlanCards
          plans={plans.data}
          interval={interval}
          current={m.plan}
          earlyAccess={m.early_access?.plan ?? null}
          onJoin={join}
          joining={joining}
          canBuy={canBuy}
          sale={sale}
          onBuy={buy}
          buying={buying}
          testMode={testMode}
          selected={intent && effective.id === "free" ? intent.plan : null}
        />
        <details className="mt-6">
          <summary className="cursor-pointer text-[13px] font-medium text-accent">Compare all features</summary>
          <div className="mt-4">
            <FeatureMatrix plans={plans.data} />
          </div>
        </details>
      </section>

      <Card className="mt-10">
        <CardHeader title="Billing history" />
        {invoices.data?.length ? (
          <ul className="divide-y divide-line">
            {invoices.data.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 px-5 py-3 text-[13px]">
                <span>{formatDate(i.paid_at)} · {i.provider_invoice_id}</span>
                <span className="num">{formatMoney(Number(i.amount_cents), i.currency)} · {i.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-5 text-[13px] text-muted">No payments. ScopeFlow hasn't charged you anything.</p>
        )}
      </Card>
      <p className="mt-6 text-center text-[12px] text-muted">
        Questions? See <Link to="/pricing" className="underline hover:text-ink">pricing and FAQ</Link> or the{" "}
        <Link to="/refunds" className="underline hover:text-ink">refund and cancellation policy</Link>.
      </p>
    </div>
  );
}
