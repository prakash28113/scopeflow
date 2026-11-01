/** Monthly analytics: pure helpers (tested in tests/unit/analytics.test.ts). All money in minor units. */

/** A payment milestone (what's owed). paid_cents = received so far. */
export type PaymentFact = { paid_at: string | null; status: string; amount_cents: number; paid_cents?: number; currency: string; due_date: string | null; client: string; project: string; project_id: string };
/** Money actually received, on the day it arrived (one row per payment record). */
export type ReceiptFact = { paid_on: string; amount_cents: number; currency: string; client: string };
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
