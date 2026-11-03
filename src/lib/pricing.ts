/**
 * Pricing and timeline maths. The database (create_change_order) is the
 * authority; these functions mirror it for live previews and are tested to agree.
 */

/** "3.25" -> 325. Null if more than two decimals or out of range. */
export function parseHours(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const hundredths = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (hundredths <= 0 || hundredths > 1_000_000) return null;
  return hundredths;
}

/** Integer-only half-up rounding: matches PostgreSQL round(numeric) for positive values. */
export function hourlyAmount(hoursHundredths: number, rateMinor: number): number {
  return Math.floor((hoursHundredths * rateMinor + 50) / 100);
}

export type ChangeOrderPricing =
  | { type: "fixed"; amountMinor: number }
  | { type: "hourly"; hoursHundredths: number; rateMinor: number };

export function changeOrderAmount(p: ChangeOrderPricing): number {
  return p.type === "fixed" ? p.amountMinor : hourlyAmount(p.hoursHundredths, p.rateMinor);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function currentDueDate(dueDate: string | null, extraDays: number): string | null {
  return dueDate ? addDays(dueDate, extraDays) : null;
}

export interface Totals {
  original: number;
  extras: number;
  contract: number;
  scheduled: number;
  paid: number;
  outstanding: number;
  unscheduled: number;
}

/** Money received against a payment milestone (part payments count). */
export function received(m: { amount_cents: number; status: string; paid_cents?: number | null }): number {
  return m.paid_cents !== undefined && m.paid_cents !== null ? Number(m.paid_cents) : m.status === "paid" ? Number(m.amount_cents) : 0;
}

export function projectTotals(
  budgetMinor: number,
  extrasMinor: number,
  milestones: { amount_cents: number; status: string; paid_cents?: number | null }[],
): Totals {
  const contract = budgetMinor + extrasMinor;
  const scheduled = milestones.reduce((s, m) => s + Number(m.amount_cents), 0);
  const paid = milestones.reduce((s, m) => s + received(m), 0);
  return {
    original: budgetMinor,
    extras: extrasMinor,
    contract,
    scheduled,
    paid,
    outstanding: contract - paid,
    unscheduled: contract - scheduled,
  };
}

/** Percent increase over the original budget, one decimal place. */
export function increasePercent(originalMinor: number, addMinor: number): number | null {
  if (originalMinor <= 0) return null;
  return Math.round((addMinor / originalMinor) * 1000) / 10;
}

/** Tax on a change order's price, rounded half-up like the database: price + tax = what the client pays. */
export function withTax(subtotalMinor: number, taxBps: number) {
  const tax = Math.round((subtotalMinor * taxBps) / 10000);
  return { subtotal: subtotalMinor, tax, total: subtotalMinor + tax };
}

/** The tax inside a tax-inclusive amount, split the way invoices do (taxable = total × 10000 ÷ (10000 + rate)). */
export function taxInside(totalMinor: number, taxBps: number) {
  if (!taxBps || taxBps <= 0) return 0;
  return totalMinor - Math.round((totalMinor * 10000) / (10000 + taxBps));
}

/** GST shown on a payment line: the change order's own tax, or the quote's rate for quote payments. */
export function paymentTax(
  m: { amount_cents: number; change_order_id?: string | null },
  project: { tax_bps?: number | null; tax_label?: string | null },
  changeOrders: { id: string; tax_cents?: number | null; tax_label?: string | null; amount_cents: number }[],
): { label: string; cents: number } | null {
  if (m.change_order_id) {
    const co = changeOrders.find((c) => c.id === m.change_order_id);
    const cents = Number(co?.tax_cents ?? 0);
    if (!co || cents <= 0) return null;
    // A change order's payment is the whole change order; if it was split, take its share.
    const share = Number(co.amount_cents) === Number(m.amount_cents) ? cents : Math.round((cents * Number(m.amount_cents)) / Number(co.amount_cents));
    return { label: co.tax_label || "GST", cents: share };
  }
  const cents = taxInside(Number(m.amount_cents), Number(project.tax_bps ?? 0));
  return cents > 0 ? { label: project.tax_label || "GST", cents } : null;
}
