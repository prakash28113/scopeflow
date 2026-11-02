import { useState } from "react";
import { Alert, Field, Figure, Figures, PageHeader, Select } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProfile } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { localToday } from "@/lib/upcoming";
import { categoryLabel, change, lastMonths, monthLabel, monthPeriod, within } from "@/lib/analytics";
import { ExpensesCard, useAnalyticsData } from "./analytics";

/** The expense log: what you spend for work, by month, optionally linked to a project. */
export default function ExpensesPage() {
  const q = useAnalyticsData();
  const profile = useProfile();
  const today = localToday();
  const months = lastMonths(24, today);
  const [month, setMonth] = useState(months[months.length - 1]);
  const [currencyChoice, setCurrency] = useState<string | null>(null);
  if (q.isLoading || profile.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load your expenses. Please refresh.</Alert>;
  const { projects, expenses } = q.data;

  const used = [...new Set([...projects.map((p) => p.currency), ...expenses.map((e) => e.currency)])];
  const currency = currencyChoice ?? (used.includes(profile.data?.default_currency ?? "") ? profile.data!.default_currency : (used[0] ?? profile.data?.default_currency ?? "INR"));
  const currencies = [...new Set([currency, ...used])];
  const period = monthPeriod(month);
  const inPeriod = expenses.filter((e) => e.currency === currency && within(e.spent_on, period));
  const before = period.prev ? expenses.filter((e) => e.currency === currency && within(e.spent_on, period.prev!)) : [];
  const total = inPeriod.reduce((s, e) => s + Number(e.amount_cents), 0);
  const prevTotal = before.reduce((s, e) => s + Number(e.amount_cents), 0);
  const byCategory = [...inPeriod.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount_cents)), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const linked = inPeriod.filter((e) => e.project_id).reduce((s, e) => s + Number(e.amount_cents), 0);
  const delta = change(total, prevTotal);
  const fmt = (n: number) => formatMoney(n, currency);

  return (
    <>
      <PageHeader title="Expenses" description="Log what you spend for work, so your profit is real. Only you can see this." />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Month" htmlFor="x-month">
          <Select id="x-month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-48">
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, "long")}
              </option>
            ))}
          </Select>
        </Field>
        {currencies.length > 1 ? (
          <Field label="Currency" htmlFor="x-currency">
            <Select id="x-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
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
          note={delta === null ? "Nothing to compare with last month" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} ${Math.abs(delta)}% vs last month`}
        />
        <Figure label="Biggest category" tone="neutral" value={byCategory[0] ? fmt(byCategory[0][1]) : "—"} note={byCategory[0] ? categoryLabel(byCategory[0][0]) : "No expenses yet"} />
        <Figure label="Linked to projects" tone="accent" value={fmt(linked)} note="Counts toward each project's profit" />
      </Figures>

      <ExpensesCard period={period} currency={currency} expenses={inPeriod} byCategory={byCategory} projects={projects.filter((p) => p.currency === currency && p.status !== "cancelled")} today={today} />
    </>
  );
}
