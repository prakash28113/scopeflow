import { FeatureLock } from "@/components/plans";
import { useFeature, useSoloPrice } from "@/lib/plans";
import { useState } from "react";
import {
  Alert,
  Field,
  Figure,
  Figures,
  PageHeader,
  Select,
} from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProfile } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { localToday } from "@/lib/upcoming";
import {
  categoryLabel,
  change,
  lastMonths,
  monthLabel,
  monthPeriod,
  within,
} from "@/lib/analytics";
import { ExpensesCard, useAnalyticsData } from "./analytics";

/** The expense log: what you spend for work, by month, optionally linked to a project. */
export default function ExpensesPage() {
  const allowed = useFeature("analytics");
  const price = useSoloPrice();
  const q = useAnalyticsData();
  const profile = useProfile();
  const today = localToday();
  const months = lastMonths(24, today);
  const [month, setMonth] = useState(months[months.length - 1]);
  const [currencyChoice, setCurrency] = useState<string | null>(null);
  if (q.isLoading || profile.isLoading) return <PageSpinner />;
  if (q.isError || !q.data)
    return <Alert>Couldn't load your expenses. Please refresh.</Alert>;
  const { projects, expenses } = q.data;

  const used = [
    ...new Set([
      ...projects.map((p) => p.currency),
      ...expenses.map((e) => e.currency),
    ]),
  ];
  const currency =
    currencyChoice ??
    (used.includes(profile.data?.default_currency ?? "")
      ? profile.data!.default_currency
      : (used[0] ?? profile.data?.default_currency ?? "INR"));
  const currencies = [...new Set([currency, ...used])];
  const period = monthPeriod(month);
  const inPeriod = expenses.filter(
    (e) => e.currency === currency && within(e.spent_on, period),
  );
  const before = period.prev
    ? expenses.filter(
        (e) => e.currency === currency && within(e.spent_on, period.prev!),
      )
    : [];
  const total = inPeriod.reduce((s, e) => s + Number(e.amount_cents), 0);
  const prevTotal = before.reduce((s, e) => s + Number(e.amount_cents), 0);
  const byCategory = [
    ...inPeriod.reduce(
      (m, e) =>
        m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount_cents)),
      new Map<string, number>(),
    ),
  ].sort((a, b) => b[1] - a[1]);
  const linked = inPeriod
    .filter((e) => e.project_id)
    .reduce((s, e) => s + Number(e.amount_cents), 0);
  const delta = change(total, prevTotal);
  const fmt = (n: number) => formatMoney(n, currency);

  // Free, nothing logged: a clear locked state (no empty month picker or ₹0 figures).
  if (!allowed && expenses.length === 0)
    return (
      <>
        <PageHeader title="Expenses" description="Log what you spend for work, so your profit is real. Only you can see this." />
        <div className="relative">
          <SamplePreview />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-lg">
              <FeatureLock title="Expenses are a Solo feature" body="Log what you spend for work, link it to projects and see your real profit." price={price} />
            </div>
          </div>
        </div>
      </>
    );

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Log what you spend for work, so your profit is real. Only you can see this."
      />
      {allowed ? null : (
        <div className="mb-5">
          <FeatureLock
            compact
            title="Expenses are a Solo feature"
            body={
              expenses.length
                ? "Your past expenses stay here to view. Upgrade to add new ones."
                : "Log what you spend for work and see your real profit."
            }
            price={price}
          />
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Month" htmlFor="x-month">
          <Select
            id="x-month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-48"
          >
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, "long")}
              </option>
            ))}
          </Select>
        </Field>
        {currencies.length > 1 ? (
          <Field label="Currency" htmlFor="x-currency">
            <Select
              id="x-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-28"
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <Figures label="This month">
        <Figure
          label={`Spent in ${monthLabel(month, "long")}`}
          tone="warning"
          value={fmt(total)}
          testid="expenses-total"
          note={
            delta === null
              ? "Nothing to compare with last month"
              : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} ${Math.abs(delta)}% vs last month`
          }
        />
        <Figure
          label="Biggest category"
          tone="neutral"
          value={byCategory[0] ? fmt(byCategory[0][1]) : "—"}
          note={
            byCategory[0] ? categoryLabel(byCategory[0][0]) : "No expenses yet"
          }
        />
        <Figure
          label="Linked to projects"
          tone="accent"
          value={fmt(linked)}
          note="Counts toward each project's profit"
        />
      </Figures>

      <ExpensesCard
        readOnly={!allowed}
        period={period}
        currency={currency}
        expenses={inPeriod}
        byCategory={byCategory}
        projects={projects.filter(
          (p) => p.currency === currency && p.status !== "cancelled",
        )}
        today={today}
      />
    </>
  );
}

/** A blurred example of the expense log, behind the Free plan's lock. Decorative only. */
function SamplePreview() {
  const rows: [string, string, string][] = [
    ["Figma subscription", "Software & subscriptions", "₹1,200.00"],
    ["Stock photos for Chai & Co.", "Assets", "₹850.00"],
    ["Co-working day pass", "Workspace", "₹500.00"],
    ["Font licence", "Assets", "₹2,400.00"],
  ];
  return (
    <div aria-hidden className="pointer-events-none select-none rounded-[var(--radius-card)] border border-line bg-surface opacity-60 blur-[3px]" data-testid="expenses-sample">
      <div className="grid grid-cols-3 gap-3 border-b border-line p-5">
        {["Spent this month", "Linked to projects", "Biggest category"].map((l) => (
          <div key={l}>
            <p className="text-[12px] text-muted">{l}</p>
            <p className="mt-1 h-6 w-24 rounded bg-sunken" />
          </div>
        ))}
      </div>
      <ul className="divide-y divide-line">
        {rows.map(([d, c, a]) => (
          <li key={d} className="flex justify-between px-5 py-3 text-[13px]">
            <span>
              <span className="block font-medium">{d}</span>
              <span className="text-[12px] text-muted">{c}</span>
            </span>
            <span className="num">{a}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
