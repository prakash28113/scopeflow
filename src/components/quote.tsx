import { useState } from "react";
import { Button } from "./ui";
import { useToast } from "./toast";
import { formatMoney } from "@/lib/money";
import { quoteTotals } from "@/lib/quote";
import type { PricingType, QuotePricing } from "@/lib/types";

type Line = {
  id?: string;
  title: string;
  pricing_type?: PricingType | null;
  hours?: string | number | null;
  rate_cents?: number | null;
  amount_cents?: number | null;
  quantity?: string | number | null;
  unit_label?: string | null;
};

/** "6.5 h × ₹1,200.00" or "10 posts × ₹500.00"; null for fixed prices. */
export function lineBasis(l: Line, currency: string): string | null {
  if (l.rate_cents == null) return null;
  const rate = formatMoney(Number(l.rate_cents), currency);
  if (l.pricing_type === "hourly" && l.hours != null) return `${Number(l.hours)} h × ${rate}`;
  if (l.pricing_type === "unit" && l.quantity != null) return `${Number(l.quantity)}${l.unit_label ? ` ${l.unit_label}` : ""} × ${rate}`;
  return null;
}

/** Quote totals from saved deliverables + project settings (the same maths the database uses). */
export function pricingFrom(lines: Line[], discountBps?: number | null, taxBps?: number | null, taxLabel?: string | null): QuotePricing | null {
  if (!lines.length || lines.some((l) => !l.pricing_type || l.amount_cents == null)) return null;
  const t = quoteTotals(lines.map((l) => Number(l.amount_cents)), discountBps ?? 0, taxBps ?? 0);
  return { subtotal_cents: t.subtotal, discount_bps: discountBps ?? 0, discount_cents: t.discount, tax_label: taxLabel ?? null, tax_bps: taxBps ?? 0, tax_cents: t.tax, total_cents: t.total };
}

const pct = (bps: number) => `${(bps / 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`;

export function QuoteTable({ lines, pricing, currency, className }: { lines: Line[]; pricing: QuotePricing; currency: string; className?: string }) {
  const fmt = (n: number) => formatMoney(Number(n), currency);
  return (
    <div className={className}>
      <table className="w-full text-[13px]" data-testid="quote-table">
        <caption className="sr-only">Quote</caption>
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th scope="col" className="pb-2 font-medium">Item</th>
            <th scope="col" className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="border-t border-line align-top">
              <td className="py-2 pr-3">
                {l.title}
                {lineBasis(l, currency) ? <span className="num block text-[12px] text-muted">{lineBasis(l, currency)}</span> : null}
              </td>
              <td className="num py-2 text-right">
                {fmt(Number(l.amount_cents ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="num">
          <tr className="border-t border-line-strong">
            <td className="pt-2 text-muted">Subtotal</td>
            <td className="pt-2 text-right">{fmt(pricing.subtotal_cents)}</td>
          </tr>
          {pricing.discount_cents ? (
            <tr>
              <td className="pt-1 text-muted">Discount ({pct(pricing.discount_bps)})</td>
              <td className="pt-1 text-right">−{fmt(pricing.discount_cents)}</td>
            </tr>
          ) : null}
          {pricing.tax_bps ? (
            <tr>
              <td className="pt-1 text-muted">
                {pricing.tax_label || "Tax"} ({pct(pricing.tax_bps)})
              </td>
              <td className="pt-1 text-right">{fmt(pricing.tax_cents)}</td>
            </tr>
          ) : null}
          <tr className="text-[15px] font-semibold">
            <td className="pt-2">Total</td>
            <td className="pt-2 text-right">{fmt(pricing.total_cents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Prints only the element marked data-print-scope (browsers offer "Save as PDF"). */
export function PrintButton({ label = "Save as PDF", size = "sm" }: { label?: string; size?: "sm" | "md" }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      className="print:hidden"
      onClick={() => {
        document.body.classList.add("print-scope");
        const done = () => {
          document.body.classList.remove("print-scope");
          window.removeEventListener("afterprint", done);
        };
        window.addEventListener("afterprint", done);
        window.print();
        setTimeout(done, 1000);
      }}
    >
      {label}
    </Button>
  );
}

/**
 * Saves the document as a PDF file in one tap (made in the browser; nothing is uploaded).
 * Finds the document from `selector`, or the [data-print-scope] element around or on the page.
 */
export function DownloadPdfButton({ name, selector, size = "sm", variant = "secondary" }: { name: string; selector?: string; size?: "sm" | "md"; variant?: "primary" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className="print:hidden"
      disabled={busy}
      onClick={async (e) => {
        const btn = e.currentTarget;
        const el = (selector ? document.querySelector(selector) : (btn.closest("[data-print-scope]") ?? document.querySelector("[data-print-scope]"))) as HTMLElement | null;
        if (!el) return;
        setBusy(true);
        try {
          const { downloadPdf } = await import("@/lib/pdf");
          await downloadPdf(el, name);
        } catch {
          toast("danger", "Couldn't create the PDF on this device. Use Print and choose “Save as PDF” instead.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Preparing PDF…" : "Download PDF"}
    </Button>
  );
}
