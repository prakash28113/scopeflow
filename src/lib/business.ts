/**
 * The seller's tax details, shown wherever a price is charged. Display text only: no amount, plan
 * or Razorpay setting reads this file.
 */

/** Shown under the Solo price, next to Upgrade, in Razorpay's window, in the Terms and the pricing FAQ. */
export const PRICE_TAX_NOTE = "₹499/month. No GST is charged: ScopeFlow isn't GST-registered.";

/** ScopeFlow's own GSTIN. Empty = not registered: nothing about a GSTIN is shown anywhere. */
export const BUSINESS_GSTIN: string = "";

/** "GSTIN 36ABCDE1234F1Z5" for the footer, Contact and Terms; null while there's no GSTIN. */
export const businessGstinLine = (gstin: string = BUSINESS_GSTIN): string | null => (gstin.trim() ? `GSTIN ${gstin.trim()}` : null);
