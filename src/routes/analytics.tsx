import { FeatureLock } from "@/components/plans";
import { useFeature, useSoloPrice } from "@/lib/plans";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Figure,
  Figures,
  Input,
  Meter,
  PageHeader,
  Select,
  Tag,
} from "@/components/ui";
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
  customPeriod,
  financialYears,
  fyQuarters,
  lastMonths,
  monthLabel,
  monthPeriod,
  monthly,
  periodTotals,
  projectProfits,
  receivables,
  topClientsIn,
  remaining,
  within,
  type Period,
  type PeriodKind,
  type PaymentFact,
  type ReceiptFact,
} from "@/lib/analytics";

export type ProjectRow = {
  id: string;
  title: string;
  currency: string;
  status: string;
  approved_at: string | null;
  completed_at: string | null;
  budget_cents: number;
  approved_extras_cents: number;
  clients: { name: string; company: string | null } | null;
  milestones: {
    id: string;
    amount_cents: number;
    status: string;
    paid_at: string | null;
    due_date: string | null;
    paid_cents: number;
  }[];
  deliverables: { progress: Progress }[];
};
export type ExpenseRow = {
  id: string;
  spent_on: string;
  category: string;
  description: string | null;
  amount_cents: number;
  currency: string;
  project_id: string | null;
  projects: { title: string } | null;
};

export const analyticsQuery = {
  queryKey: ["analytics"],
  queryFn: async () => {
    const [projects, invoices, expenses, payments] = await Promise.all([
      supabase
        .from("projects")
        .select(
          "id, title, currency, status, approved_at, completed_at, budget_cents, approved_extras_cents, clients(name, company), milestones(id, amount_cents, status, paid_at, due_date, paid_cents), deliverables(progress)",
        ),
      supabase
        .from("client_invoices")
        .select("issue_date, amount_cents, currency, voided_at"),
      supabase
        .from("expenses")
        .select(
          "id, spent_on, category, description, amount_cents, currency, project_id, projects(title)",
        )
        .order("spent_on", { ascending: false }),
      supabase.from("payments").select("amount_cents, paid_on, project_id"),
    ]);
    for (const r of [projects, invoices, expenses, payments])
      if (r.error) throw r.error;
    return {
      projects: projects.data as unknown as ProjectRow[],
      invoices: invoices.data as {
        issue_date: string;
        amount_cents: number;
        currency: string;
        voided_at: string | null;
      }[],
      expenses: expenses.data as unknown as ExpenseRow[],
      payments: payments.data as {
        amount_cents: number;
        paid_on: string;
        project_id: string;
      }[],
    };
  },
};

export function useAnalyticsData() {
  return useQuery(analyticsQuery);
}

export default function AnalyticsPage() {
  const allowed = useFeature("analytics");
  const price = useSoloPrice();
  if (!allowed)
    return (
      <>
        <PageHeader
          title="Analytics"
          description="Money in, money out and how your projects are going, by month, quarter or financial year."
        />
        <FeatureLock
          title="Analytics is a Solo feature"
          body="See what you received, spent and kept each month, quarter or financial year, profit by project, top clients and what's still owed."
          price={price}
        />
      </>
    );
  return <Analytics />;
}

function Analytics() {
  const q = useAnalyticsData();
  const profile = useProfile();
  const today = localToday();
  const months = lastMonths(12, today);
  const [month, setMonth] = useState(months[months.length - 1]);
  const [kind, setKind] = useState<PeriodKind>("month");
  const quarters = fyQuarters(today);
  const years = financialYears(today);
  const [quarterKey, setQuarterKey] = useState(quarters[0].key);
  const [yearKey, setYearKey] = useState(years[0].key);
  const [range, setRange] = useState({
    from: `${today.slice(0, 7)}-01`,
    to: today,
  });
  const [currencyChoice, setCurrency] = useState<string | null>(null);

  if (q.isLoading || profile.isLoading) return <PageSpinner />;
  if (q.isError || !q.data)
    return <Alert>Couldn't load analytics. Please refresh.</Alert>;
  const { projects, invoices, expenses, payments: paymentRows } = q.data;

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
  const fmt = (n: number) => formatMoney(n, currency);
  const vsPrev = (d: number | null) =>
    d === null
      ? undefined
      : `${d > 0 ? "▲" : d < 0 ? "▼" : "■"} ${Math.abs(d)}% vs ${period.prevLabel}`;

  const payments: PaymentFact[] = projects.flatMap((p) =>
    p.approved_at && p.status !== "cancelled"
      ? p.milestones.map((m) => ({
          ...m,
          currency: p.currency,
          client: p.clients?.company || p.clients?.name || "Client",
          project: p.title,
          project_id: p.id,
        }))
      : [],
  );
  const byId = new Map(projects.map((p) => [p.id, p]));
  const receipts: ReceiptFact[] = paymentRows.flatMap((r) => {
    const p = byId.get(r.project_id);
    return p
      ? [
          {
            paid_on: r.paid_on,
            amount_cents: r.amount_cents,
            currency: p.currency,
            client: p.clients?.company || p.clients?.name || "Client",
          },
        ]
      : [];
  });
  const rows = monthly(months, currency, { receipts, invoices, expenses });
  const custom = customPeriod(range.from, range.to);
  const period: Period =
    kind === "quarter"
      ? (quarters.find((x) => x.key === quarterKey) ?? quarters[0])
      : kind === "fy"
        ? (years.find((x) => x.key === yearKey) ?? years[0])
        : kind === "custom" && custom
          ? custom
          : monthPeriod(month);
  const facts = { receipts, invoices, expenses };
  const cur = periodTotals(period, currency, facts);
  const prev = period.prev ? periodTotals(period.prev, currency, facts) : null;
  const owed = receivables(payments, currency, today);
  const clients = topClientsIn(receipts, currency, period);
  const profits = projectProfits(
    projects.map((p) => ({
      id: p.id,
      title: p.title,
      client: p.clients?.company || p.clients?.name || "Client",
      status: p.status,
      currency: p.currency,
      approved_at: p.approved_at,
      contract: Number(p.budget_cents) + Number(p.approved_extras_cents),
    })),
    paymentRows,
    expenses,
    currency,
  );
  const approvedInCur = projects.filter(
    (p) => p.currency === currency && p.approved_at && p.status !== "cancelled",
  );
  const avgValue = approvedInCur.length
    ? Math.round(
        approvedInCur.reduce(
          (s, p) =>
            s + Number(p.budget_cents) + Number(p.approved_extras_cents),
          0,
        ) / approvedInCur.length,
      )
    : 0;
  const inCur = projects.filter((p) => p.currency === currency);
  const active = inCur.filter((p) => p.status === "active");
  const approvedInPeriod = inCur.filter(
    (p) => p.approved_at && within(p.approved_at, period),
  ).length;
  const completedInPeriod = inCur.filter(
    (p) => p.completed_at && within(p.completed_at, period),
  ).length;
  const monthExpenses = expenses.filter(
    (e) => e.currency === currency && within(e.spent_on, period),
  );
  const byCategory = [
    ...monthExpenses.reduce(
      (m, e) =>
        m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount_cents)),
      new Map<string, number>(),
    ),
  ].sort((a, b) => b[1] - a[1]);
  const hasAnything =
    payments.length || expenses.length || invoices.length || receipts.length;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Money in, money out and how your projects are going, by month, quarter or financial year."
      />
      <div
        className="mb-5 flex flex-wrap items-end gap-3"
        data-testid="period-filter"
      >
        <Field label="Period" htmlFor="a-kind">
          <Select
            id="a-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as PeriodKind)}
            className="w-40"
          >
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
            <option value="fy">Financial year</option>
            <option value="custom">Custom dates</option>
          </Select>
        </Field>
        {kind === "month" ? (
          <Field label="Month" htmlFor="a-month">
            <Select
              id="a-month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            >
              {[...months].reverse().map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, "long")}
                </option>
              ))}
            </Select>
          </Field>
        ) : kind === "quarter" ? (
          <Field label="Quarter" htmlFor="a-quarter">
            <Select
              id="a-quarter"
              value={quarterKey}
              onChange={(e) => setQuarterKey(e.target.value)}
              className="w-64"
            >
              {quarters.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : kind === "fy" ? (
          <Field label="Financial year" htmlFor="a-fy" hint="April to March">
            <Select
              id="a-fy"
              value={yearKey}
              onChange={(e) => setYearKey(e.target.value)}
              className="w-40"
            >
              {years.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="From" htmlFor="a-from">
              <Input
                id="a-from"
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) =>
                  setRange((r) => ({ ...r, from: e.target.value }))
                }
              />
            </Field>
            <Field
              label="To"
              htmlFor="a-to"
              error={
                custom
                  ? undefined
                  : "Choose a start date on or before the end date"
              }
            >
              <Input
                id="a-to"
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) =>
                  setRange((r) => ({ ...r, to: e.target.value }))
                }
              />
            </Field>
          </>
        )}
        {currencies.length > 1 ? (
          <Field label="Currency" htmlFor="a-currency">
            <Select
              id="a-currency"
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

      <Figures label="Key figures">
        <Figure
          label="Received"
          tone="accent"
          value={fmt(cur.received)}
          note={
            vsPrev(prev ? change(cur.received, prev.received) : null) ??
            "Payments marked as received"
          }
          testid="kpi-received"
        />
        <Figure
          label="Invoiced"
          tone="neutral"
          value={fmt(cur.invoiced)}
          note={
            vsPrev(prev ? change(cur.invoiced, prev.invoiced) : null) ??
            "Invoices issued (not void)"
          }
        />
        <Figure
          label="Expenses"
          tone="warning"
          value={fmt(cur.expenses)}
          note={
            vsPrev(prev ? change(cur.expenses, prev.expenses) : null) ??
            "From your expense log"
          }
          testid="kpi-expenses"
        />
        <Figure
          label="Profit"
          tone="positive"
          value={fmt(cur.profit)}
          note={
            vsPrev(prev ? change(cur.profit, prev.profit) : null) ??
            "Received minus expenses"
          }
          testid="kpi-profit"
        />
      </Figures>

      {!hasAnything ? (
        <Card className="mb-6">
          <EmptyState
            title="Nothing to show yet"
            body="Once clients approve projects and you mark payments as received, your monthly numbers appear here. You can log expenses below."
          />
        </Card>
      ) : (
        <Card className="mb-6">
          <CardHeader
            title="Monthly trend"
            description={`In ${currency}. Last 12 months (6 on a phone; the table has all 12). Tap a month to see its details.`}
          />
          <div className="px-4 py-4 sm:px-5">
            <MonthlyChart
              rows={rows}
              currency={currency}
              selected={kind === "month" ? month : ""}
              onSelect={(m) => {
                setKind("month");
                setMonth(m);
              }}
            />
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Money owed to you"
            description="Unpaid payments on approved projects."
          />
          <dl className="num grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 text-[13px]">
            <dt className="text-muted">Outstanding</dt>
            <dd
              className="text-right font-semibold"
              data-testid="owed-outstanding"
            >
              {fmt(owed.outstanding)}
            </dd>
            <dt className="text-muted">Overdue</dt>
            <dd
              className={`text-right font-semibold ${owed.overdue ? "text-warning" : ""}`}
            >
              {fmt(owed.overdue)}
            </dd>
          </dl>
          {owed.overdueItems.length ? (
            <ul className="divide-y divide-line">
              {owed.overdueItems.slice(0, 5).map((p) => (
                <li
                  key={p.project_id + p.due_date + p.amount_cents}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]"
                >
                  <Link
                    to={`/projects/${p.project_id}`}
                    className="min-w-0 hover:underline"
                  >
                    <p className="truncate font-medium">{p.client}</p>
                    <p className="truncate text-[12px] text-muted">
                      {p.project} · due {formatDate(p.due_date)}
                    </p>
                  </Link>
                  <span className="num shrink-0">{fmt(remaining(p))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-[13px] text-muted">
              Nothing overdue. 🎉
            </p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Top clients"
            description={`By money received · ${period.label}`}
          />
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
            <p className="px-5 py-4 text-[13px] text-muted">
              No payments received in this period.
            </p>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Projects"
          description={`${period.label} · ${currency}`}
        />
        <dl className="num grid grid-cols-2 gap-4 border-b border-line px-5 py-4 text-center text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-muted">In progress</dt>
            <dd className="mt-1 text-lg font-semibold">{active.length}</dd>
          </div>
          <div>
            <dt className="text-muted">Approved in period</dt>
            <dd className="mt-1 text-lg font-semibold">{approvedInPeriod}</dd>
          </div>
          <div>
            <dt className="text-muted">Completed in period</dt>
            <dd className="mt-1 text-lg font-semibold">{completedInPeriod}</dd>
          </div>
          <div>
            <dt className="text-muted">Average project value</dt>
            <dd
              className="mt-1 text-lg font-semibold"
              data-testid="avg-project-value"
            >
              {approvedInCur.length ? fmt(avgValue) : "—"}
            </dd>
          </div>
        </dl>
        {active.length ? (
          <ul className="divide-y divide-line">
            {active.map((p) => {
              const s = progressSummary(p.deliverables);
              return (
                <li key={p.id} className="px-5 py-3 text-[13px]">
                  <div className="mb-1 flex justify-between gap-3">
                    <Link
                      to={`/projects/${p.id}`}
                      className="truncate font-medium hover:underline"
                    >
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
          <p className="px-5 py-4 text-[13px] text-muted">
            No projects in progress.
          </p>
        )}
      </Card>

      <ProfitByProject rows={profits} currency={currency} />

      <Card>
        <CardHeader
          title="Spending by category"
          description={`${period.label} · ${currency}`}
          action={
            <Link
              to="/expenses"
              className="text-[13px] font-medium text-accent hover:underline"
            >
              Log and manage expenses
            </Link>
          }
        />
        {byCategory.length ? (
          <ul
            className="space-y-3 px-5 py-4"
            data-testid="spending-by-category"
          >
            {byCategory.map(([c, v]) => (
              <li key={c} className="text-[13px]">
                <div className="mb-1 flex justify-between gap-3">
                  <span className="truncate font-medium">
                    {categoryLabel(c)}
                  </span>
                  <span className="num">{fmt(v)}</span>
                </div>
                <Meter value={v} max={byCategory[0][1]} tone="warning" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-[13px] text-muted">
            No expenses in this period.{" "}
            <Link
              to="/expenses"
              className="font-medium text-accent hover:underline"
            >
              Log one
            </Link>{" "}
            so your profit is real.
          </p>
        )}
      </Card>
    </>
  );
}

export function ExpensesCard({
  period,
  currency,
  expenses,
  byCategory,
  projects,
  today,
  readOnly = false,
}: {
  /** Free plan: past expenses stay visible, nothing can be added or deleted. */
  readOnly?: boolean;
  period: Period;
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
  const defaultDate = within(today, period)
    ? today
    : period.to < today
      ? period.to
      : period.from;

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const cents = parseAmount(String(f.get("amount") ?? ""), currency);
    if (!cents || cents <= 0)
      return setError("Enter an amount greater than zero.");
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
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["analytics"] }),
      qc.invalidateQueries({ queryKey: ["project"] }),
    ]);
  }

  return (
    <Card>
      <CardHeader
        title={`Expenses · ${period.label}`}
        description="Log what you spend for work, so profit is real. Only you can see this."
      />
      {readOnly ? null : (
        <form
          onSubmit={add}
          className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-[140px_1fr_140px] lg:grid-cols-[140px_200px_140px_1fr_200px_auto] lg:items-end"
          noValidate
          data-testid="expense-form"
        >
          {error ? (
            <div className="sm:col-span-full">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          <Field label="Date" htmlFor="x-date">
            <Input
              id="x-date"
              name="date"
              type="date"
              max={today}
              defaultValue={defaultDate}
              key={defaultDate}
              required
            />
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
            <Input
              id="x-amt"
              name="amount"
              inputMode="decimal"
              placeholder="0"
              required
            />
          </Field>
          <Field label="What for (optional)" htmlFor="x-desc">
            <Input
              id="x-desc"
              name="description"
              maxLength={200}
              placeholder="Figma subscription"
            />
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
      )}
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
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {e.description || categoryLabel(e.category)}
                  </p>
                  <p className="truncate text-[12px] text-muted">
                    {formatDate(e.spent_on)} · {categoryLabel(e.category)}
                    {e.projects ? ` · ${e.projects.title}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="num">{fmt(Number(e.amount_cents))}</span>
                  {readOnly ? null : (
                    <ActionButton
                      size="sm"
                      variant="ghost"
                      confirm="Delete this expense?"
                      aria-label={`Delete expense ${e.description || categoryLabel(e.category)}`}
                      onAction={async () => {
                        const r = await call(() =>
                          supabase.rpc("delete_expense", {
                            p_expense_id: e.id,
                          }),
                        );
                        if (!r.ok) toast("danger", r.message);
                        await Promise.all([
                          qc.invalidateQueries({ queryKey: ["analytics"] }),
                          qc.invalidateQueries({ queryKey: ["project"] }),
                        ]);
                      }}
                    >
                      Delete
                    </ActionButton>
                  )}
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
        <p className="px-5 py-4 text-[13px] text-muted">
          No expenses logged for {period.label}.
        </p>
      )}
    </Card>
  );
}

/** All-time profit per project: received minus the expenses you linked to it. */
function ProfitByProject({
  rows,
  currency,
}: {
  rows: ReturnType<typeof projectProfits>;
  currency: string;
}) {
  const [all, setAll] = useState(false);
  const fmt = (n: number) => formatMoney(n, currency);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Card className="mb-6">
      <CardHeader
        title="Profit by project"
        description={`All time · ${currency}. Received minus the expenses you linked to each project.`}
      />
      {rows.length ? (
        <>
          <div className="overflow-x-auto">
            <table
              className="num w-full min-w-[520px] text-[13px]"
              data-testid="project-profit"
            >
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium">
                    Project
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Contract
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Received
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Expenses
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    Profit
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="max-w-[220px] px-5 py-2.5">
                      <Link
                        to={`/projects/${r.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {r.title}
                      </Link>
                      <span className="block truncate text-[12px] text-muted">
                        {r.client}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted">
                      {fmt(r.contract)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {fmt(r.received)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.expenses ? `−${fmt(r.expenses)}` : "—"}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-semibold ${r.profit < 0 ? "text-danger" : ""}`}
                    >
                      {fmt(r.profit)}
                      {r.margin !== null ? (
                        <span className="block text-[11px] font-normal text-muted">
                          {r.margin}% margin
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 8 ? (
            <div className="border-t border-line px-5 py-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAll((x) => !x)}
              >
                {all ? "Show fewer" : `Show all ${rows.length}`}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="px-5 py-4 text-[13px] text-muted">
          Once a client approves a project, its profit appears here. Link
          expenses to a project when you log them.
        </p>
      )}
    </Card>
  );
}
