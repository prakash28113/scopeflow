import { formatMoney } from "./money";
/** Payments received against payment milestones. */
export type PaymentMethod = "upi" | "bank_transfer" | "cash" | "card" | "cheque" | "paypal" | "other";
export type PaymentRecord = {
  id: string;
  milestone_id: string;
  project_id: string;
  amount_cents: number;
  /** TDS the client withheld on this payment (0 if none). */
  tds_cents?: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string | null;
  created_at: string;
};
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "paypal", label: "PayPal" },
  { value: "other", label: "Other" },
];
export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? "Other";

/** Help text for the optional TDS field. A record only: no rate, no calculation, no advice. */
export const TDS_LABEL = "TDS deducted by client (optional)";
export const TDS_HELP = "Only if your client withheld TDS. ScopeFlow just records it; it doesn't calculate tax.";

export type PaymentForm = { amount: string; tds: string; date: string; method: string; reference: string };
/**
 * Checks the Record payment form and builds what record_payment() receives. Amounts are typed in
 * the currency's main unit (₹) and sent in its minor unit (paise).
 */
export function paymentPayload(f: PaymentForm, currency: string, due: number, today: string, parse: (v: string, c: string) => number | null):
  | { ok: true; cash: number; tds: number; payload: { amount_cents: number; tds_cents: number; paid_on: string; method: string; reference: string } }
  | { ok: false; error: string } {
  const cash = f.amount.trim() === "" ? 0 : parse(f.amount, currency);
  const tds = f.tds.trim() === "" ? 0 : parse(f.tds, currency);
  if (cash === null || cash < 0) return { ok: false, error: "Enter the amount received." };
  if (tds === null || tds < 0) return { ok: false, error: "Enter the TDS amount, or leave it empty." };
  if (cash + tds <= 0) return { ok: false, error: "Enter the amount received." };
  if (cash + tds > due) return { ok: false, error: `That's more than the ${formatMoney(due, currency)} still due.` };
  if (!f.date || f.date > today) return { ok: false, error: "Enter the date you received it (not in the future)." };
  return { ok: true, cash, tds, payload: { amount_cents: cash, tds_cents: tds, paid_on: f.date, method: f.method, reference: f.reference } };
}
