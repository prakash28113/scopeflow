/**
 * "What's still owed" has three honest answers, each with its own label everywhere it appears:
 *
 * - Contract unpaid: the agreed contract (quote + approved change orders) minus what was received.
 *   Dashboard, client page, project page, approval record.
 * - Scheduled & due: payments already scheduled (and so invoiceable) that aren't fully paid yet.
 *   Analytics → Money owed to you.
 * - Invoice balance: an issued invoice's total minus what was received against it.
 *   The invoice itself ("Balance due").
 *
 * Contract unpaid ≥ Scheduled & due ≥ the balance of issued invoices; the gap between the first two
 * is the part of the contract no payment covers yet.
 */
import { received } from "./pricing";

type Milestone = { amount_cents: number; status: string; paid_cents?: number | null };

export const OUTSTANDING_LABEL = {
  contract: "Contract unpaid",
  scheduled: "Scheduled & due",
  invoice: "Balance due",
} as const;

/** Contract total (incl. approved change orders) minus everything received. */
export function contractUnpaid(p: { budget_cents: number; approved_extras_cents: number; milestones: Milestone[] }): number {
  const paid = p.milestones.reduce((s, m) => s + received(m), 0);
  return Math.max(0, Number(p.budget_cents) + Number(p.approved_extras_cents) - paid);
}

/** What's left on one scheduled payment. */
export const dueOn = (m: Milestone) => (m.status === "paid" ? 0 : Math.max(0, Number(m.amount_cents) - received(m)));

/** Unpaid scheduled payments. */
export const scheduledDue = (milestones: Milestone[]) => milestones.reduce((s, m) => s + dueOn(m), 0);

/** Issued, not void, not fully paid invoices: their total minus what was received against each payment. */
export function invoiceBalance(invoices: { amount_cents: number; voided_at?: string | null; milestones?: Milestone | null }[]): number {
  return invoices.reduce((s, i) => (i.voided_at ? s : s + Math.max(0, Number(i.amount_cents) - (i.milestones ? received(i.milestones) : 0))), 0);
}
