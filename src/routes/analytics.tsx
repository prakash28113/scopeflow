import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, Meter, PageHeader, Select, Tag } from "@/components/ui";
import { ActionButton } from "@/components/form-bits";
import { PageSpinner } from "@/components/app-shell";
import { MonthlyChart } from "@/components/monthly-chart";
import { useToast } from "@/components/toast";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { useProfile } from "@/lib/auth";
import { formatMoney, parseAmount } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { localToday } from "@/lib/upcoming";
import { progressSummary, type Progress } from "@/lib/progress";
import {
  EXPENSE_CATEGORIES,
  categoryLabel,
  change,
  lastMonths,
  monthLabel,
  monthOf,
  monthly,
  receivables,
  topClients,
  type PaymentFact,
} from "@/lib/analytics";

type ProjectRow = {
  id: string;
  title: string;
  currency: string;
  status: string;
  approved_at: string | null;
  completed_at: string | null;
  clients: { name: string; company: string | null } | null;
  milestones: { id: string; amount_cents: number; status: string; paid_at: string | null; due_date: string | null }[];
  deliverables: { progress: Progress }[];
};
type ExpenseRow = { id: string; spent_on: string; category: string; description: string | null; amount_cents: number; currency: string; project_id: string | null; projects: { title: string } | null };

function useAnalyticsData() {
  return useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const [projects, invoices, expenses] = await Promise.all([
        supabase
          .from("projects")
          .select("id, title, currency, status, approved_at, completed_at, clients(name, company), milestones(id, amount_cents, status, paid_at, due_date), deliverables(progress)"),
        supabase.from("client_invoices").select("issue_date, amount_cents, currency, voided_at"),
        supabase.from("expenses").select("id, spent_on, category, description, amount_cents, currency, project_id, projects(title)").order("spent_on", { ascending: false }),
      ]);
      for (const r of [projects, invoices, expenses]) if (r.error) throw r.error;
      return {
        projects: projects.data as unknown as ProjectRow[],
        invoices: invoices.data as { issue_date: string; amount_cents: number; currency: string; voided_at: string | null }[],
        expenses: expenses.data as unknown as ExpenseRow[],
      };
    },
  });
}

function Kpi({ label, value, delta, hint, testid }: { label: string; value: string; delta?: number | null; hint?: string; testid?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="num mt-1 truncate text-xl font-semibold tracking-[-0.02em]" title={value} data-testid={testid}>
        {value}
      </p>
      <p className="num mt-0.5 text-[12px] text-muted">
        {delta === null || delta === undefined ? (hint ?? " ") : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} ${Math.abs(delta)}% vs last month`}
      </p>
    </Card>
  );
}

export default function AnalyticsPage() {
  const q = useAnalyticsData();
  const profile = useProfile();
  const today = localToday();
  const months = lastMonths(12, today);
  const [month, setMonth] = useState(months[months.length - 1]);
  const [currencyChoice, setCurrency] = useState<string | null>(null);

  if (q.isLoading || profile.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load analytics. Please refresh.</Alert>;
  const { projects, invoices, expenses } = q.data;

  const used = [...new Set([...projects.map((p) => p.currency), ...expenses.map((e) => e.currency)])];
  const currency = currencyChoice ?? (used.includes(profile.data?.default_currency ?? "") ? profile.data!.default_currency : (used[0] ?? profile.data?.default_currency ?? "INR"));
  const currencies = [...new Set([currency, ...used])];
  const fmt = (n: number) => formatMoney(n, currency);

  const payments: PaymentFact[] = projects.flatMap((p) =>
    p.approved_at && p.status !== "cancelled"
      ? p.milestones.map((m) => ({ ...m, currency: p.currency, client: p.clients?.company || p.clients?.name || "Client", project: p.title, project_id: p.id }))
      : [],
  );
  const rows = monthly(months, currency, { payments, invoices, expenses });
  const idx = rows.findIndex((r) => r.month === month);
  const cur = rows[idx];
  const prev = rows[idx - 1];
  const owed = receivables(payments, currency, today);
  const clients = topClients(payments, currency, months);
  const inCur = projects.filter((p) => p.currency === currency);
  const active = inCur.filter((p) => p.status === "active");
  const approvedThisMonth = inCur.filter((p) => p.approved_at && monthOf(p.approved_at) === month).length;
  const completedThisMonth = inCur.filter((p) => p.completed_at && monthOf(p.completed_at) === month).length;
  const monthExpenses = expenses.filter((e) => e.currency === currency && monthOf(e.spent_on) === month);
  const byCategory = [...monthExpenses.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount_cents)), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const hasAnything = payments.length || expenses.length || invoices.length;

  return (
    <>
      <PageHeader title="Analytics" description="Money in, money out and how your projects are going, month by month." />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Month" htmlFor="a-month">
          <Select id="a-month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44">
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, "long")}
              </option>
            ))}
          </Select>
        </Field>
        {currencies.length > 1 ? (
          <Field label="Currency" htmlFor="a-currency">
            <Select id="a-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Received" value={fmt(cur.received)} delta={change(cur.received, prev?.received ?? 0)} hint="Payments marked as received" testid="kpi-received" />
        <Kpi label="Invoiced" value={fmt(cur.invoiced)} delta={change(cur.invoiced, prev?.invoiced ?? 0)} hint="Invoices issued (not void)" />
        <Kpi label="Expenses" value={fmt(cur.expenses)} delta={change(cur.expenses, prev?.expenses ?? 0)} hint="From your expense log" testid="kpi-expenses" />
        <Kpi label="Profit" value={fmt(cur.profit)} delta={change(cur.profit, prev?.profit ?? 0)} hint="Received − expenses" testid="kpi-profit" />
      </div>

      {!hasAnything ? (
        <Card className="mb-6">
          <EmptyState title="Nothing to show yet" body="Once clients approve projects and you mark payments as received, your monthly numbers appear here. You can log expenses below." />
        </Card>
      ) : (
        <Card className="mb-6">
          <CardHeader title="Last 12 months" description={`In ${currency}. Tap a month to see its details.`} />
          <div className="px-4 py-4 sm:px-5">
            <MonthlyChart rows={rows} currency={currency} selected={month} onSelect={setMonth} />
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Money owed to you" description="Unpaid payments on approved projects." />
          <dl className="num grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 text-[13px]">
            <dt className="text-muted">Outstanding</dt>
            <dd className="text-right font-semibold" data-testid="owed-outstanding">{fmt(owed.outstanding)}</dd>
            <dt className="text-muted">Overdue</dt>
            <dd className={`text-right font-semibold ${owed.overdue ? "text-warning" : ""}`}>{fmt(owed.overdue)}</dd>
          </dl>
          {owed.overdueItems.length ? (
            <ul className="divide-y divide-line">
              {owed.overdueItems.slice(0, 5).map((p) => (
                <li key={p.project_id + p.due_date + p.amount_cents} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                  <Link to={`/projects/${p.project_id}`} className="min-w-0 hover:underline">
                    <p className="truncate font-medium">{p.client}</p>
                    <p className="truncate text-[12px] text-muted">
                      {p.project} · due {formatDate(p.due_date)}
                    </p>
                  </Link>
                  <span className="num shrink-0">{fmt(Number(p.amount_cents))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-[13px] text-muted">Nothing overdue. 🎉</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Top clients" description="By money received in the last 12 months." />
          {clients.length ? (
            <ul className="space-y-3 px-5 py-4">
              {clients.map((c) => (
                <li key={c.client} className="text-[13px]">
                  <div className="mb-1 flex justify-between gap-3">
                    <span className="truncate font-medium">{c.client}</span>
                    <span className="num">{fmt(c.cents)}</span>
                  </div>
                  <Meter value={c.cents} max={clients[0].cents} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-[13px] text-muted">No payments received yet.</p>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Projects" description={`${monthLabel(month, "long")} · ${currency}`} />
        <dl className="num grid grid-cols-3 gap-4 border-b border-line px-5 py-4 text-center text-[13px]">
          <div>
            <dt className="text-muted">In progress</dt>
            <dd className="mt-1 text-lg font-semibold">{active.length}</dd>
          </div>
          <div>
            <dt className="text-muted">Approved this month</dt>
            <dd className="mt-1 text-lg font-semibold">{approvedThisMonth}</dd>
          </div>
          <div>
            <dt className="text-muted">Completed this month</dt>
            <dd className="mt-1 text-lg font-semibold">{completedThisMonth}</dd>
          </div>
        </dl>
        {active.length ? (
          <ul className="divide-y divide-line">
            {active.map((p) => {
              const s = progressSummary(p.deliverables);
              return (
                <li key={p.id} className="px-5 py-3 text-[13px]">
                  <div className="mb-1 flex justify-between gap-3">
                    <Link to={`/projects/${p.id}`} className="truncate font-medium hover:underline">
                      {p.title}
                    </Link>
                    <span className="num shrink-0 text-muted">{s.label}</span>
                  </div>
                  <Meter value={s.pct} max={100} tone="positive" />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-4 text-[13px] text-muted">No projects in progress.</p>
        )}
      </Card>

      <ExpensesCard month={month} currency={currency} expenses={monthExpenses} byCategory={byCategory} projects={inCur.filter((p) => p.status !== "cancelled")} today={today} />
    </>
  );
}

function ExpensesCard({
  month,
  currency,
  expenses,
  byCategory,
  projects,
  today,
}: {
  month: string;
  currency: string;
  expenses: ExpenseRow[];
  byCategory: [string, number][];
  projects: ProjectRow[];
  today: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fmt = (n: number) => formatMoney(n, currency);
  const total = expenses.reduce((s, e) => s + Number(e.amount_cents), 0);
  const defaultDate = month === today.slice(0, 7) ? today : `${month}-01`;

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const cents = parseAmount(String(f.get("amount") ?? ""), currency);
    if (!cents || cents <= 0) return setError("Enter an amount greater than zero.");
    setPending(true);
    setError(null);
    const r = await call(() =>
      supabase.rpc("add_expense", {
        p: {
          spent_on: String(f.get("date")),
          category: String(f.get("category")),
          amount_cents: cents,
          currency,
          description: String(f.get("description") ?? ""),
          project_id: String(f.get("project") || "") || null,
        },
      }),
    );
    setPending(false);
    if (!r.ok) return setError(r.message);
    form.reset();
    toast("positive", "Expense added.");
    await qc.invalidateQueries({ queryKey: ["analytics"] });
  }

  return (
    <Card>
      <CardHeader title={`Expenses · ${monthLabel(month, "long")}`} description="Log what you spend for work, so profit is real. Only you can see this." />
      <form onSubmit={add} className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-[140px_1fr_140px] lg:grid-cols-[140px_200px_140px_1fr_200px_auto] lg:items-end" noValidate data-testid="expense-form">
        {error ? <div className="sm:col-span-full"><Alert>{error}</Alert></div> : null}
        <Field label="Date" htmlFor="x-date">
          <Input id="x-date" name="date" type="date" max={today} defaultValue={defaultDate} key={defaultDate} required />
        </Field>
        <Field label="Category" htmlFor="x-cat">
          <Select id="x-cat" name="category" defaultValue="software">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="x-amt">
          <Input id="x-amt" name="amount" inputMode="decimal" placeholder="0" required />
        </Field>
        <Field label="What for (optional)" htmlFor="x-desc">
          <Input id="x-desc" name="description" maxLength={200} placeholder="Figma subscription" />
        </Field>
        <Field label="Project (optional)" htmlFor="x-proj">
          <Select id="x-proj" name="project" defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add expense"}
        </Button>
      </form>
      {expenses.length ? (
        <>
          <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
            {byCategory.map(([c, v]) => (
              <Tag key={c}>
                {categoryLabel(c)} · {fmt(v)}
              </Tag>
            ))}
          </div>
          <ul className="divide-y divide-line" data-testid="expense-list">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.description || categoryLabel(e.category)}</p>
                  <p className="truncate text-[12px] text-muted">
                    {formatDate(e.spent_on)} · {categoryLabel(e.category)}
                    {e.projects ? ` · ${e.projects.title}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="num">{fmt(Number(e.amount_cents))}</span>
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    confirm="Delete this expense?"
                    aria-label={`Delete expense ${e.description || categoryLabel(e.category)}`}
                    onAction={async () => {
                      const r = await call(() => supabase.rpc("delete_expense", { p_expense_id: e.id }));
                      if (!r.ok) toast("danger", r.message);
                      await qc.invalidateQueries({ queryKey: ["analytics"] });
                    }}
                  >
                    Delete
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
          <p className="num flex justify-between px-5 py-3 text-[13px] font-semibold">
            <span>Total</span>
            <span>{fmt(total)}</span>
          </p>
        </>
      ) : (
        <p className="px-5 py-4 text-[13px] text-muted">No expenses logged for {monthLabel(month, "long")}.</p>
      )}
    </Card>
  );
}
