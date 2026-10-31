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

export function projectTotals(
  budgetMinor: number,
  extrasMinor: number,
  milestones: { amount_cents: number; status: string }[],
): Totals {
  const contract = budgetMinor + extrasMinor;
  const scheduled = milestones.reduce((s, m) => s + Number(m.amount_cents), 0);
  const paid = milestones.filter((m) => m.status === "paid").reduce((s, m) => s + Number(m.amount_cents), 0);
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
