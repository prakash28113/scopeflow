import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Card, CardHeader, PageHeader, Tag } from "@/components/ui";
import { FeatureMatrix, IntervalToggle, PlanCards, UsageMeter } from "@/components/plans";
import { PageSpinner } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { STATUS_TEXT, useInvoices, useMyPlan, usePlans, type Interval, type PlanId } from "@/lib/plans";

export default function PlanPage() {
  const plans = usePlans();
  const mine = useMyPlan();
  const invoices = useInvoices();
  const qc = useQueryClient();
  const toast = useToast();
  const [interval, setInterval] = useState<Interval>("year");
  const [joining, setJoining] = useState<PlanId | null>(null);

  if (plans.isLoading || mine.isLoading) return <PageSpinner />;
  if (plans.isError || mine.isError || !plans.data || !mine.data) return <Alert>Couldn't load your plan. Please refresh.</Alert>;
  const m = mine.data;
  const plan = plans.data.find((p) => p.id === m.plan)!;
  const effective = plans.data.find((p) => p.id === m.effective_plan)!;
  const paid = m.plan !== "free";

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
                The last payment didn't go through. Paid features stay on until {formatDate(m.grace_until)}; after that the account uses Free limits. Nothing is deleted.
              </p>
            ) : null}
            {effective.id !== plan.id ? (
              <p className="rounded-md bg-sunken px-3 py-2 text-ink-2">Free plan limits apply right now.</p>
            ) : null}
          </dl>
          <p className="border-t border-line px-5 py-3 text-[12px] text-muted">
            {paid
              ? "Plan changes and cancellation will be available here when paid plans launch. Downgrading never deletes projects."
              : "Free forever. Completed and cancelled projects don't count toward your limit."}
          </p>
        </Card>

        <Card>
          <CardHeader title="Usage" description={`${effective.name} plan limits`} />
          <div className="space-y-4 px-5 py-4">
            <UsageMeter label="Active projects" used={m.usage.active_projects} limit={m.limits.active_projects} />
            <UsageMeter label="Clients" used={m.usage.clients} limit={m.limits.clients} />
            <p className="text-[12px] text-muted">Active = draft, waiting for approval, changes requested, or in progress.</p>
          </div>
        </Card>
      </div>

      <section className="mt-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Plans</h2>
            <p className="mt-1 text-[13px] text-muted">Paid plans are in early access. Joining the list is free and takes no payment details.</p>
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
        <PlanCards plans={plans.data} interval={interval} current={m.plan} earlyAccess={m.early_access?.plan ?? null} onJoin={join} joining={joining} />
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
          <p className="px-5 py-5 text-[13px] text-muted">No payments. ScopeFlow hasn't charged you anything; paid plans aren't on sale yet.</p>
        )}
      </Card>
      <p className="mt-6 text-center text-[12px] text-muted">
        Questions? See <Link to="/pricing" className="underline hover:text-ink">pricing and FAQ</Link>.
      </p>
    </div>
  );
}
