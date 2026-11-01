/** Monthly analytics: pure helpers (tested in tests/unit/analytics.test.ts). All money in minor units. */

/** A payment milestone (what's owed). paid_cents = received so far. */
export type PaymentFact = { paid_at: string | null; status: string; amount_cents: number; paid_cents?: number; currency: string; due_date: string | null; client: string; project: string; project_id: string };
/** Money actually received, on the day it arrived (one row per payment record). */
export type ReceiptFact = { paid_on: string; amount_cents: number; currency: string; client: string; project_id?: string };
export type InvoiceFact = { issue_date: string; amount_cents: number; currency: string; voided_at: string | null };
export type ExpenseFact = { spent_on: string; amount_cents: number; currency: string; category: string };
export type MonthRow = { month: string; received: number; invoiced: number; expenses: number; profit: number };

/** YYYY-MM in the viewer's time zone for a timestamp; date-only strings are taken as written. */
export function monthOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The last n months ending with the month of `today` (YYYY-MM-DD), oldest first. */
export function lastMonths(n: number, today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

export function monthLabel(month: string, style: "short" | "long" = "short"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", style === "short" ? { month: "short" } : { month: "long", year: "numeric" });
}

export function monthly(months: string[], currency: string, f: { receipts: ReceiptFact[]; invoices: InvoiceFact[]; expenses: ExpenseFact[] }): MonthRow[] {
  const rows = new Map(months.map((m) => [m, { month: m, received: 0, invoiced: 0, expenses: 0, profit: 0 }]));
  for (const p of f.receipts) {
    if (p.currency !== currency) continue;
    const r = rows.get(monthOf(p.paid_on));
    if (r) r.received += Number(p.amount_cents);
  }
  for (const i of f.invoices) {
    if (i.currency !== currency || i.voided_at) continue;
    const r = rows.get(monthOf(i.issue_date));
    if (r) r.invoiced += Number(i.amount_cents);
  }
  for (const e of f.expenses) {
    if (e.currency !== currency) continue;
    const r = rows.get(monthOf(e.spent_on));
    if (r) r.expenses += Number(e.amount_cents);
  }
  return months.map((m) => {
    const r = rows.get(m)!;
    return { ...r, profit: r.received - r.expenses };
  });
}

/** Change vs the previous value as a whole-number percentage; null when there's nothing to compare. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

/** Still owed on a payment milestone (part payments reduce it). */
export const remaining = (p: PaymentFact) => (p.status === "paid" ? 0 : Math.max(0, Number(p.amount_cents) - Number(p.paid_cents ?? 0)));

/** Unpaid payments on live projects: total, and the overdue part (due before today). */
export function receivables(payments: PaymentFact[], currency: string, today: string) {
  const open = payments.filter((p) => p.currency === currency && remaining(p) > 0);
  const overdue = open.filter((p) => p.due_date && p.due_date < today).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const sum = (xs: PaymentFact[]) => xs.reduce((s, p) => s + remaining(p), 0);
  return { outstanding: sum(open), overdue: sum(overdue), overdueItems: overdue };
}

/** Clients ranked by money received in the given months. */
export function topClients(receipts: ReceiptFact[], currency: string, months: string[], limit = 5) {
  const set = new Set(months);
  const by = new Map<string, number>();
  for (const p of receipts) {
    if (p.currency !== currency || !set.has(monthOf(p.paid_on))) continue;
    by.set(p.client, (by.get(p.client) ?? 0) + Number(p.amount_cents));
  }
  return [...by].map(([client, cents]) => ({ client, cents })).sort((a, b) => b.cents - a.cents).slice(0, limit);
}

/** A clean axis maximum (1, 2, 2.5 or 5 × 10^n) at or above the data maximum, with 4 ticks. */
export function niceScale(max: number): { max: number; ticks: number[] } {
  if (max <= 0) return { max: 100, ticks: [0, 25, 50, 75, 100] };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw)!;
  return { max: step * 4, ticks: [0, step, step * 2, step * 3, step * 4] };
}

export const EXPENSE_CATEGORIES = [
  { value: "software", label: "Software & subscriptions" },
  { value: "equipment", label: "Equipment" },
  { value: "contractors", label: "Contractors" },
  { value: "travel", label: "Travel" },
  { value: "marketing", label: "Marketing" },
  { value: "office", label: "Office & internet" },
  { value: "fees", label: "Bank & platform fees" },
  { value: "taxes", label: "Taxes" },
  { value: "other", label: "Other" },
] as const;
export const categoryLabel = (v: string) => EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? "Other";

// ---------------------------------------------------------------- periods

export type PeriodKind = "month" | "quarter" | "fy" | "custom";
/** An inclusive date range (YYYY-MM-DD), with the range just before it for comparison. */
export type Period = { kind: PeriodKind; key: string; from: string; to: string; label: string; prev: { from: string; to: string } | null; prevLabel: string };

const iso = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.toISOString().slice(0, 10);
};
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const shiftDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysIn = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** The local calendar day of a timestamp; date-only strings are taken as written. */
export function dayOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const within = (value: string, r: { from: string; to: string }) => {
  const d = dayOf(value);
  return d >= r.from && d <= r.to;
};

export function monthPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number);
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
  return {
    kind: "month",
    key: month,
    from: iso(y, m, 1),
    to: iso(y, m, lastDay(y, m)),
    label: monthLabel(month, "long"),
    prev: { from: iso(prev[0], prev[1], 1), to: iso(prev[0], prev[1], lastDay(prev[0], prev[1])) },
    prevLabel: "last month",
  };
}

/** Indian financial year that a date falls in: FY 2026–27 runs 1 Apr 2026 – 31 Mar 2027. Returns the starting year. */
export const fyOf = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return m >= 4 ? y : y - 1;
};
const fyLabel = (start: number) => `FY ${start}–${String(start + 1).slice(2)}`;

/** Financial-year quarters (Q1 = Apr–Jun … Q4 = Jan–Mar), newest first, starting with the current one. */
export function fyQuarters(today: string, n = 8): Period[] {
  let fy = fyOf(today);
  const [, m] = today.split("-").map(Number);
  let q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  const out: Period[] = [];
  for (let i = 0; i < n; i++) {
    const startMonth = ((q - 1) * 3 + 3) % 12 + 1; // Q1→4, Q2→7, Q3→10, Q4→1
    const y = q === 4 ? fy + 1 : fy;
    const from = iso(y, startMonth, 1);
    const to = iso(y, startMonth + 2, lastDay(y, startMonth + 2));
    const names = ["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"];
    out.push({ kind: "quarter", key: `${fy}-Q${q}`, from, to, label: `Q${q} ${fyLabel(fy)} (${names[q - 1]} ${y})`, prev: null, prevLabel: "previous quarter" });
    q -= 1;
    if (q === 0) {
      q = 4;
      fy -= 1;
    }
  }
  return out.map((p) => ({ ...p, prev: { from: quarterBefore(p.from), to: shiftDays(p.from, -1) } }));
}
function quarterBefore(from: string): string {
  const [y, m] = from.split("-").map(Number);
  const pm = m - 3 <= 0 ? m + 9 : m - 3;
  const py = m - 3 <= 0 ? y - 1 : y;
  return iso(py, pm, 1);
}

/** Indian financial years (April–March), newest first, starting with the current one. */
export function financialYears(today: string, n = 3): Period[] {
  const now = fyOf(today);
  return Array.from({ length: n }, (_, i) => {
    const fy = now - i;
    return { kind: "fy" as const, key: `FY${fy}`, from: iso(fy, 4, 1), to: iso(fy + 1, 3, 31), label: fyLabel(fy), prev: { from: iso(fy - 1, 4, 1), to: iso(fy, 3, 31) }, prevLabel: "previous year" };
  });
}

/** A custom range; compared with the same number of days just before it. Null if invalid. */
export function customPeriod(from: string, to: string): Period | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  const n = daysIn(from, to);
  if (n > 3700) return null;
  return {
    kind: "custom",
    key: `${from}_${to}`,
    from,
    to,
    label: `${from} to ${to}`,
    prev: { from: shiftDays(from, -n), to: shiftDays(from, -1) },
    prevLabel: `previous ${n} day${n === 1 ? "" : "s"}`,
  };
}

export type Totals = { received: number; invoiced: number; expenses: number; profit: number };

/** Received, invoiced, expenses and profit within a date range, in one currency. */
export function periodTotals(r: { from: string; to: string }, currency: string, f: { receipts: ReceiptFact[]; invoices: InvoiceFact[]; expenses: ExpenseFact[] }): Totals {
  const sum = <T,>(xs: T[], ok: (x: T) => boolean, amt: (x: T) => number) => xs.reduce((s, x) => (ok(x) ? s + amt(x) : s), 0);
  const received = sum(f.receipts, (p) => p.currency === currency && within(p.paid_on, r), (p) => Number(p.amount_cents));
  const invoiced = sum(f.invoices, (i) => i.currency === currency && !i.voided_at && within(i.issue_date, r), (i) => Number(i.amount_cents));
  const expenses = sum(f.expenses, (e) => e.currency === currency && within(e.spent_on, r), (e) => Number(e.amount_cents));
  return { received, invoiced, expenses, profit: received - expenses };
}

/** Clients ranked by money received within a date range. */
export function topClientsIn(receipts: ReceiptFact[], currency: string, r: { from: string; to: string }, limit = 5) {
  const by = new Map<string, number>();
  for (const p of receipts) {
    if (p.currency !== currency || !within(p.paid_on, r)) continue;
    by.set(p.client, (by.get(p.client) ?? 0) + Number(p.amount_cents));
  }
  return [...by].map(([client, cents]) => ({ client, cents })).sort((a, b) => b.cents - a.cents).slice(0, limit);
}

// ---------------------------------------------------------------- per-project profit

export type ProjectProfit = { id: string; title: string; client: string; status: string; contract: number; received: number; expenses: number; profit: number; margin: number | null };

/**
 * All-time profit per project, in one currency: money received minus expenses linked to the project.
 * Margin = profit ÷ received (null before anything is received). Sorted by profit, highest first.
 */
export function projectProfits(
  projects: { id: string; title: string; client: string; status: string; currency: string; approved_at: string | null; contract: number }[],
  receipts: { project_id: string; amount_cents: number }[],
  expenses: { project_id: string | null; amount_cents: number; currency: string }[],
  currency: string,
): ProjectProfit[] {
  const rec = new Map<string, number>();
  for (const r of receipts) rec.set(r.project_id, (rec.get(r.project_id) ?? 0) + Number(r.amount_cents));
  const exp = new Map<string, number>();
  for (const e of expenses) if (e.project_id && e.currency === currency) exp.set(e.project_id, (exp.get(e.project_id) ?? 0) + Number(e.amount_cents));
  return projects
    .filter((p) => p.currency === currency && (p.approved_at || exp.has(p.id)) && p.status !== "cancelled")
    .map((p) => {
      const received = rec.get(p.id) ?? 0;
      const expenses = exp.get(p.id) ?? 0;
      const profit = received - expenses;
      return { id: p.id, title: p.title, client: p.client, status: p.status, contract: p.contract, received, expenses, profit, margin: received > 0 ? Math.round((profit / received) * 100) : null };
    })
    .sort((a, b) => b.profit - a.profit || a.title.localeCompare(b.title));
}
