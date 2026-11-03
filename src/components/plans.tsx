import { Link } from "react-router";
import { Button, Meter, buttonClass, cx } from "./ui";
import { limitText, priceLabel, type Interval, type Plan, type PlanId, type PlanLimit } from "@/lib/plans";

export function IntervalToggle({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  const opt = (v: Interval, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      onClick={() => onChange(v)}
      className={cx("rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors", value === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Billing" className="inline-flex rounded-lg border border-line-strong bg-sunken p-0.5">
      {opt("month", "Monthly")}
      {opt("year", "Yearly · 2 months free")}
    </div>
  );
}

/** What each plan offers, honestly: features that aren't built yet say "Coming". */
const HIGHLIGHTS: Record<PlanId, string[]> = {
  free: ["Scope agreements, approvals, revision tracking", "Change orders, quotes and GST invoices", "Payment tracking and reminders"],
  solo: ["Everything in Free", "Unlimited projects and clients", "Analytics, expenses and profit", "Approval record PDF export"],
  studio: ["Everything in Solo", "Up to 3 team members — coming", "White-label client portal — coming"],
};

export function PlanCards({
  plans,
  interval,
  current,
  earlyAccess,
  onJoin,
  joining,
  canBuy,
  onBuy,
  buying,
  testMode,
}: {
  plans: Plan[];
  interval: Interval;
  current?: PlanId;
  earlyAccess?: PlanId | null;
  /** Signed in: join early access in place. Signed out: link to sign-up. */
  onJoin?: (plan: PlanId) => void;
  joining?: PlanId | null;
  /** Signed in: can this plan be bought now (on sale, or a tester in test mode)? */
  canBuy?: (plan: Plan) => boolean;
  onBuy?: (plan: PlanId) => void;
  buying?: PlanId | null;
  testMode?: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p) => {
        const price = priceLabel(p, interval);
        const recommended = p.id === "solo";
        const isCurrent = current === p.id;
        const buyable = Boolean(onBuy && canBuy?.(p));
        return (
          <section
            key={p.id}
            aria-label={`${p.name} plan`}
            className={cx(
              "relative flex flex-col rounded-[var(--radius-card)] border bg-surface p-6",
              recommended ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-line",
            )}
          >
            {recommended ? (
              <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-white">Recommended</span>
            ) : null}
            <h3 className="text-[15px] font-semibold">{p.name}</h3>
            <p className="mt-3 flex items-baseline gap-1">
              <span className="num text-[32px] font-semibold tracking-[-0.03em]">{price.main}</span>
              <span className="text-[13px] text-muted">{price.per}</span>
            </p>
            <p className="num mt-1 min-h-[18px] text-[12px] text-positive">{price.note}</p>
            <ul className="mt-5 space-y-2 text-[13px] text-ink-2">
              <li className="font-medium text-ink">{limitText(p.max_active_projects, "active projects")}</li>
              <li className="font-medium text-ink">{limitText(p.max_clients, "clients")}</li>
              {HIGHLIGHTS[p.id].map((h) => (
                <li key={h} className={cx(h.endsWith("coming") && "text-muted")}>
                  {h}
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-1 md:mt-auto">
              {isCurrent ? (
                <p className="rounded-lg bg-sunken px-3 py-2 text-center text-[13px] font-medium text-ink-2">Your current plan</p>
              ) : p.id === "free" ? (
                onJoin ? null : (
                  <Link to="/signup" className={cx(buttonClass("secondary"), "w-full")}>
                    Start free
                  </Link>
                )
              ) : buyable ? (
                <Button className="w-full" variant={recommended ? "primary" : "secondary"} disabled={Boolean(buying)} onClick={() => onBuy!(p.id)}>
                  {buying === p.id ? "Opening payment…" : `Upgrade to ${p.name}`}
                </Button>
              ) : !onJoin && p.purchasable ? (
                <Link to="/signup" className={cx(buttonClass(recommended ? "primary" : "secondary"), "w-full")}>
                  Start free, upgrade anytime
                </Link>
              ) : earlyAccess === p.id ? (
                <p className="rounded-lg bg-accent-soft px-3 py-2 text-center text-[13px] font-medium text-accent-hover">On the early-access list</p>
              ) : onJoin ? (
                <Button className="w-full" variant={recommended ? "primary" : "secondary"} disabled={joining === p.id} onClick={() => onJoin(p.id)}>
                  {joining === p.id ? "Joining…" : "Join early access"}
                </Button>
              ) : (
                <Link to="/signup?plan=early" className={cx(buttonClass(recommended ? "primary" : "secondary"), "w-full")}>
                  Start free, join early access
                </Link>
              )}
              {p.id === "free" || isCurrent ? null : buyable || p.purchasable ? (
                <p className="mt-2 text-center text-[11px] text-muted">
                  {buyable && testMode ? "Test mode: no real money moves." : "Paid securely through Razorpay. Cancel anytime."}
                </p>
              ) : (
                <p className="mt-2 text-center text-[11px] text-muted">Not on sale yet — no payment taken.</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type Cell = string | ((p: Plan) => string);
const ROWS: { label: string; cells: [Cell, Cell, Cell]; soon?: boolean }[] = [
  { label: "Active projects", cells: [(p) => limitText(p.max_active_projects, ""), (p) => limitText(p.max_active_projects, ""), (p) => limitText(p.max_active_projects, "")] },
  { label: "Clients", cells: [(p) => limitText(p.max_clients, ""), (p) => limitText(p.max_clients, ""), (p) => limitText(p.max_clients, "")] },
  { label: "Scope agreements, exclusions, terms, locked versions", cells: ["✓", "✓", "✓"] },
  { label: "Client approval links (no client account)", cells: ["✓", "✓", "✓"] },
  { label: "Revision tracker and extra-round pricing", cells: ["✓", "✓", "✓"] },
  { label: "Change orders", cells: ["✓", "✓", "✓"] },
  { label: "Itemised quotes with discount and GST, save as PDF", cells: ["✓", "✓", "✓"] },
  { label: "Invoices with GST, UPI QR and PDF", cells: ["✓", "✓", "✓"] },
  { label: "Payments: part payments, dates and methods (recorded manually)", cells: ["✓", "✓", "✓"] },
  { label: "Deliverable progress and project timeline", cells: ["✓", "✓", "✓"] },
  { label: "Upcoming deadlines and payments", cells: ["✓", "✓", "✓"] },
  { label: "Expense log and analytics (profit, trends, top clients)", cells: ["—", "✓", "✓"] },
  { label: "Agreement templates", cells: ["Starter set", "Full library", "Full library"] },
  { label: "Approval record: proof of everything agreed", cells: ["✓", "✓", "✓"] },
  { label: "Approval record PDF export", cells: ["—", "✓", "✓"] },
  { label: "Team members and roles", cells: ["—", "—", "Up to 3"], soon: true },
  { label: "White-label client portal", cells: ["—", "—", "✓"], soon: true },
];

export function FeatureMatrix({ plans }: { plans: Plan[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <caption className="sr-only">Compare plans</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-3 font-medium text-muted">Feature</th>
            {plans.map((p) => (
              <th key={p.id} scope="col" className="px-4 py-3 font-semibold">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ROWS.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="px-4 py-2.5 font-normal text-ink-2">
                {r.label}
                {r.soon ? <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">Coming</span> : null}
              </th>
              {plans.map((p, i) => {
                const c = r.cells[i];
                const v = typeof c === "function" ? c(p).trim() : c;
                return (
                  <td key={p.id} className={cx("num px-4 py-2.5", v === "—" ? "text-subtle" : "text-ink")}>
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const full = limit !== null && used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className={cx("num font-medium", full ? "text-warning" : "text-ink")}>{limit === null ? `${used} · unlimited` : `${used} of ${limit}`}</span>
      </div>
      <div className="mt-1.5">
        <Meter value={used} max={limit ?? Math.max(used, 1) * 4} tone={full ? "warning" : "accent"} />
      </div>
    </div>
  );
}

/** Shown when the database refuses a creation because of the plan. Explains, never nags. */
export function PlanLimitCard({ limit }: { limit: PlanLimit }) {
  const what = limit.kind === "clients" ? "clients" : "active projects";
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-warning/40 bg-warning-soft p-5">
      <p className="text-sm font-semibold text-ink">You've reached the Free plan's {what}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{limit.message}</p>
      <div className="mt-3 max-w-xs">
        <UsageMeter label={what[0].toUpperCase() + what.slice(1)} used={limit.used} limit={limit.limit} />
      </div>
      <p className="mt-3 text-[13px] text-ink-2">Your existing projects and client links keep working. Nothing is locked or deleted.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/plan" className={buttonClass("primary", "sm")}>
          See plans
        </Link>
        <Link to="/dashboard" className={buttonClass("secondary", "sm")}>
          Go to projects
        </Link>
      </div>
    </div>
  );
}

/** A paid feature on Free: visible, locked, with one way to upgrade. */
export function FeatureLock({ title, body, price, compact = false }: { title: string; body: string; price: string; compact?: boolean }) {
  return (
    <div
      className={cx("rounded-[14px] border border-accent-line bg-accent-soft/60", compact ? "flex flex-wrap items-center justify-between gap-3 px-4 py-3" : "px-5 py-6 text-center")}
      data-testid="feature-lock"
    >
      <div className={compact ? "min-w-0" : undefined}>
        <p className={cx("flex items-center gap-1.5 font-semibold text-ink", compact ? "text-[14px]" : "justify-center text-[16px]")}>
          <LockIcon />
          {title}
        </p>
        <p className={cx("text-ink-2", compact ? "mt-0.5 text-[13px]" : "mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed")}>
          {body} <span className="font-medium text-ink">Available on Solo, {price}.</span>
        </p>
      </div>
      <Link to="/plan" className={cx(buttonClass("primary", compact ? "sm" : "md"), !compact && "mt-4")}>
        Upgrade to Solo
      </Link>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden className="shrink-0 text-accent">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
