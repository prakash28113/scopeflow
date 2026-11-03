/** Invoices issued to clients: shared types and pure helpers (tested in tests/unit/invoice.test.ts). */

export type InvoiceParty = { name: string; person?: string; company?: string; email?: string; address?: string; gstin?: string; upi_id?: string; state?: string };

/** The fields every invoice view needs (a client_invoices row, or the client page's copy of it). */
export type InvoiceDoc = {
  id: string;
  number: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  description: string;
  amount_cents: number;
  tax_label: string | null;
  tax_bps: number;
  tax_split: boolean;
  taxable_cents: number;
  tax_cents: number;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  notes: string | null;
  /** SAC code of the service and "State (code)" place of supply (tax invoices from Nov 2026). */
  sac_code?: string | null;
  place_of_supply?: string | null;
};

export type InvoiceRow = InvoiceDoc & {
  owner_id: string;
  project_id: string;
  milestone_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
};

export type InvoiceStatus = "void" | "paid" | "overdue" | "partial" | "due";

export function invoiceStatus(inv: { voided_at?: string | null; due_date: string | null }, paid: boolean, today: string, paidCents = 0): InvoiceStatus {
  if (inv.voided_at) return "void";
  if (paid) return "paid";
  if (inv.due_date && inv.due_date < today) return "overdue";
  if (paidCents > 0) return "partial";
  return "due";
}

/** "18" for 1800 bps, "2.5" for 250. */
export const percent = (bps: number) => String(Number((bps / 100).toFixed(2)));

/** Tax lines for the invoice: one line, or CGST + SGST halves (the odd paisa goes to SGST). */
export function taxRows(inv: Pick<InvoiceDoc, "tax_label" | "tax_bps" | "tax_split" | "tax_cents">): { label: string; cents: number }[] {
  if (!inv.tax_bps || !inv.tax_cents) return [];
  if (inv.tax_split) {
    const half = Math.floor(inv.tax_cents / 2);
    return [
      { label: `CGST ${percent(inv.tax_bps / 2)}%`, cents: half },
      { label: `SGST ${percent(inv.tax_bps / 2)}%`, cents: inv.tax_cents - half },
    ];
  }
  // GST charged to another state is IGST.
  const label = /^gst$/i.test(inv.tax_label ?? "") ? "IGST" : inv.tax_label || "Tax";
  return [{ label: `${label} ${percent(inv.tax_bps)}%`, cents: inv.tax_cents }];
}

/** "Tax invoice" when the seller is GST-registered and charges tax; otherwise "Invoice". */
export const invoiceTitle = (inv: Pick<InvoiceDoc, "seller" | "tax_cents">) => (inv.seller.gstin && inv.tax_cents > 0 ? "Tax invoice" : "Invoice");

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}
/** Indian numbering in words: crore, lakh, thousand. */
export function indianWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

/** "Rupees Twenty Thousand Six Hundred Fifty and Fifty Paise Only" (INR only; null otherwise). */
export function amountInWords(minor: number, currency: string): string | null {
  if (currency !== "INR") return null;
  const rupees = Math.floor(minor / 100);
  const paise = minor % 100;
  return `Rupees ${indianWords(rupees)}${paise ? ` and ${below100(paise)} Paise` : ""} Only`;
}

/** Indian GSTIN format (also checked by the database). */
export const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Same state → CGST + SGST; different states → IGST. The first two digits of a GSTIN are the state code. */
export function sameState(sellerGstin?: string | null, buyerGstin?: string | null): boolean | null {
  if (!sellerGstin || !buyerGstin) return null;
  return sellerGstin.slice(0, 2) === buyerGstin.slice(0, 2);
}

/** Local date + n days, as YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
