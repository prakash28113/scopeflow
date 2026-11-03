/**
 * Whether a paid plan is on sale: the one answer every screen uses (pricing cards, the pricing
 * footnote, Plan & usage). Pure, so it's easy to test.
 *
 * - billingBuilt: this build has Razorpay switched on (VITE_BILLING_PROVIDER, set by the release only
 *   when keys are configured).
 * - purchasable: the database says the plan is on sale (set by the release, live keys only).
 * - status: for a signed-in account, what the billing function says (null while loading or signed out).
 */
export type SaleStatus = { enabled: boolean; mode: "test" | "live" | null; tester: boolean } | null | undefined;
export type SalePlan = { id: string; purchasable: boolean };

export type Sale = {
  /** Public claim: "Paid securely through Razorpay" may be shown. */
  onSale: boolean;
  /** This signed-in account can open checkout now. */
  buyable: boolean;
  /** Buyable only as one of the owner's test accounts (no real money). */
  testMode: boolean;
};

export function planSale(plan: SalePlan, billingBuilt: boolean, status?: SaleStatus): Sale {
  if (plan.id === "free" || !billingBuilt) return { onSale: false, buyable: false, testMode: false };
  const onSale = plan.purchasable;
  if (!status) return { onSale, buyable: false, testMode: false };
  if (!status.enabled) return { onSale: false, buyable: false, testMode: false };
  if (status.mode === "test") return { onSale: false, buyable: status.tester, testMode: status.tester };
  return { onSale, buyable: onSale, testMode: false };
}

/** Any paid plan on sale (for the pricing footnote). */
export const anyOnSale = (plans: SalePlan[], billingBuilt: boolean) => plans.some((p) => planSale(p, billingBuilt).onSale);
