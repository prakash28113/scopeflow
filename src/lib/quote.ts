/**
 * Itemised quotes. The database (_quote_totals / save_project) is the authority;
 * this mirrors it for the live preview and is tested to agree with PostgreSQL.
 */
import { hourlyAmount } from "./pricing";

export type QuoteLine =
  | { type: "fixed"; amountMinor: number }
  | { type: "hourly"; hoursHundredths: number; rateMinor: number }
  | { type: "unit"; quantityHundredths: number; rateMinor: number };

export function lineAmount(l: QuoteLine): number {
  if (l.type === "fixed") return l.amountMinor;
  // Quantity × unit price rounds exactly like hours × rate.
  return hourlyAmount(l.type === "hourly" ? l.hoursHundredths : l.quantityHundredths, l.rateMinor);
}

/** Half away from zero, like PostgreSQL round(numeric), for non-negative integers: round(n * bps / 10000). */
export function applyBps(minor: number, bps: number): number {
  return Math.floor((minor * bps + 5000) / 10000);
}

export type QuoteTotals = { subtotal: number; discount: number; tax: number; total: number };

export function quoteTotals(lineAmounts: number[], discountBps = 0, taxBps = 0): QuoteTotals {
  const subtotal = lineAmounts.reduce((s, a) => s + a, 0);
  const discount = applyBps(subtotal, discountBps);
  const tax = applyBps(subtotal - discount, taxBps);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/** "18" or "12.5" percent → basis points (1800, 1250). Null if invalid or outside 0–100. */
export function parsePercent(input: string): number | null {
  const s = input.trim();
  if (s === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const bps = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return bps <= 10000 ? bps : null;
}

/**
 * A quote stays open through its last day everywhere on Earth (UTC−12), matching the database,
 * so a client in any time zone gets the whole day.
 */
export function quoteExpired(validUntil: string | null | undefined, now = new Date()): boolean {
  if (!validUntil) return false;
  return validUntil < new Date(now.getTime() - 12 * 3_600_000).toISOString().slice(0, 10);
}

export const bpsToPercent = (bps: number | null | undefined) => (bps ? String(bps / 100) : "");
