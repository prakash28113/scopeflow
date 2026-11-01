/** Payments received against payment milestones. */
export type PaymentMethod = "upi" | "bank_transfer" | "cash" | "card" | "cheque" | "paypal" | "other";
export type PaymentRecord = {
  id: string;
  milestone_id: string;
  project_id: string;
  amount_cents: number;
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
