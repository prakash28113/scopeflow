/**
 * One-tap payment nudge (SF-HABIT-3). Builds the message a freelancer sends from their own
 * WhatsApp or email app. ScopeFlow sends nothing itself, and the text never carries a link:
 * the client's private link is shown once and can't be rebuilt.
 */
import { formatMoney } from "./money";

export type NudgeTone = "gentle" | "firm";
export type NudgeInput = {
  tone: NudgeTone;
  clientName: string;
  invoiceNumber: string;
  /** What is still owed: the invoice amount minus everything already received. Never the original total if part-paid. */
  balanceCents: number;
  currency: string;
  /** YYYY-MM-DD */
  dueDate: string;
  /** YYYY-MM-DD (India calendar) */
  today: string;
  upiId?: string | null;
  businessName?: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-07" → "7 Nov" */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]}`;
}
/** Whole days from one YYYY-MM-DD to another. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const isOverdue = (dueDate: string, today: string) => dueDate < today;
/** One line of plain text: no line breaks, no leftovers of a pasted link. */
const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const firstName = (name: string) => clean(name).split(" ")[0] || "there";

export function buildNudge(i: NudgeInput): { text: string; subject: string } {
  const balance = formatMoney(Math.max(0, i.balanceCents), i.currency);
  const number = clean(i.invoiceNumber);
  const hi = `Hi ${firstName(i.clientName)},`;
  const upi = clean(i.upiId);
  const business = clean(i.businessName);
  const overdue = isOverdue(i.dueDate, i.today);
  const due = dayMonth(i.dueDate);
  let text: string;
  if (i.tone === "firm" && overdue) {
    const n = daysBetween(i.dueDate, i.today);
    const ask = upi ? `Please pay by UPI to ${upi} or let me know when to expect it.` : "Please let me know when to expect it.";
    text = `${hi} invoice ${number} for ${balance} was due on ${due} and is now ${n} day${n === 1 ? "" : "s"} overdue. ${ask} ${business ? `Thanks, ${business}` : "Thanks."}`;
  } else {
    const when = overdue ? `was due on ${due}` : `is due on ${due}`;
    text = `${hi} a quick reminder: invoice ${number} for ${balance} ${when}.${upi ? ` You can pay by UPI to ${upi}.` : ""} ${business ? `Thank you! – ${business}` : "Thank you!"}`;
  }
  return { text, subject: `Reminder: invoice ${number} (${balance})` };
}

/**
 * A phone number as WhatsApp wants it: digits only, with the country code. A 10-digit Indian
 * mobile (starting 6–9) gets 91; a number that already has a +country code keeps it. Null when
 * the result isn't a plausible international number (11–15 digits).
 */
export function waNumber(phone: string | null | undefined): string | null {
  const raw = String(phone ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+")) {
    digits = digits.replace(/^0+/, "");
    if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`;
  }
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function waLink(phone: string | null | undefined, text: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export function mailLink(email: string, subject: string, text: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/** Show the Nudge button from 3 days before the due date, and always once overdue. */
export function canNudge(inv: { voided_at?: string | null; due_date: string | null }, paid: boolean, balanceCents: number, today: string): boolean {
  if (inv.voided_at || paid || !inv.due_date || balanceCents <= 0) return false;
  return daysBetween(today, inv.due_date) <= 3;
}
