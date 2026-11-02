import qrcode from "qrcode-generator";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { amountInWords, invoiceTitle, taxRows, type InvoiceDoc, type InvoiceParty, type InvoiceStatus } from "@/lib/invoice";
import { upiPayUrl } from "@/lib/upi";
import { cx } from "./ui";

function Party({ label, p }: { label: string; p: InvoiceParty }) {
  return (
    <div className="min-w-0 text-[13px] leading-relaxed">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 font-semibold text-ink">{p.company || p.name}</p>
      {p.company ? <p>{p.name}</p> : p.person ? <p>{p.person}</p> : null}
      {p.address ? <p className="whitespace-pre-line text-ink-2">{p.address}</p> : null}
      {p.email ? <p className="break-all text-ink-2">{p.email}</p> : null}
      {p.gstin ? <p className="num">GSTIN: {p.gstin}</p> : null}
    </div>
  );
}

const STAMP: Record<InvoiceStatus, { text: string; cls: string } | null> = {
  paid: { text: "Paid", cls: "border-positive text-positive" },
  void: { text: "Void", cls: "border-danger text-danger" },
  overdue: { text: "Overdue", cls: "border-warning text-warning" },
  partial: { text: "Part paid", cls: "border-accent text-accent" },
  due: null,
};

/** A printable invoice. Add `data-print-scope` around it (it already has it) and use PrintButton to save as PDF. */
export function InvoiceDocument({ inv, status, paidAt, paidCents = 0, className }: { inv: InvoiceDoc; status: InvoiceStatus; paidAt?: string | null; paidCents?: number; className?: string }) {
  const fmt = (n: number) => formatMoney(Number(n), inv.currency);
  const taxes = taxRows(inv);
  const words = amountInWords(Number(inv.amount_cents), inv.currency);
  const stamp = STAMP[status];
  const balance = Math.max(0, Number(inv.amount_cents) - (status === "paid" ? Number(inv.amount_cents) : Number(paidCents)));
  const upi = inv.currency === "INR" && inv.seller.upi_id && status !== "paid" && status !== "void"
    ? upiPayUrl({ upiId: inv.seller.upi_id, payee: inv.seller.name, amountPaise: balance || Number(inv.amount_cents), note: inv.number })
    : null;
  const qr = upi
    ? (() => {
        const code = qrcode(0, "M");
        code.addData(upi);
        code.make();
        return code.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
      })()
    : "";

  return (
    <article data-print-scope data-testid="invoice-document" className={cx("relative rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10", className)}>
      {stamp ? (
        <span className={cx("absolute right-6 top-6 rotate-[-8deg] rounded-md border-2 px-3 py-1 text-[13px] font-bold uppercase tracking-[0.12em] sm:right-10 sm:top-10", stamp.cls)}>
          {stamp.text}
        </span>
      ) : null}
      <header className="border-b border-line pb-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">{invoiceTitle(inv)}</p>
        <h1 className="display num mt-1 text-[26px] font-semibold leading-tight">{inv.number}</h1>
        <dl className="mt-3 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-muted">Invoice date</dt>
          <dd>{formatDate(inv.issue_date)}</dd>
          <dt className="text-muted">Due date</dt>
          <dd>{inv.due_date ? formatDate(inv.due_date) : "On receipt"}</dd>
          {status === "paid" && paidAt ? (
            <>
              <dt className="text-muted">Paid on</dt>
              <dd>{formatDate(paidAt)}</dd>
            </>
          ) : null}
        </dl>
      </header>

      <section className="grid gap-6 border-b border-line py-6 sm:grid-cols-2">
        <Party label="From" p={inv.seller} />
        <Party label="Bill to" p={inv.buyer} />
      </section>

      <section className="border-b border-line py-6">
        <table className="num w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="pb-2 font-semibold">Description</th>
              <th className="pb-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <td className="py-2 pr-4">{inv.description}</td>
              <td className="py-2 text-right">{fmt(inv.taxable_cents)}</td>
            </tr>
          </tbody>
          <tfoot className="border-t border-line">
            {taxes.length ? (
              <tr>
                <td className="pt-3 text-muted">Taxable value</td>
                <td className="pt-3 text-right">{fmt(inv.taxable_cents)}</td>
              </tr>
            ) : null}
            {taxes.map((t) => (
              <tr key={t.label}>
                <td className="pt-1 text-muted">{t.label}</td>
                <td className="pt-1 text-right">{fmt(t.cents)}</td>
              </tr>
            ))}
            <tr className="text-[15px] font-semibold">
              <td className="pt-3">Total</td>
              <td className="pt-3 text-right" data-testid="invoice-total">{fmt(inv.amount_cents)}</td>
            </tr>
            {status !== "paid" && status !== "void" && paidCents > 0 ? (
              <>
                <tr>
                  <td className="pt-1 text-muted">Paid so far</td>
                  <td className="pt-1 text-right">− {fmt(paidCents)}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="pt-1">Balance due</td>
                  <td className="pt-1 text-right" data-testid="invoice-balance">{fmt(balance)}</td>
                </tr>
              </>
            ) : null}
          </tfoot>
        </table>
        {words ? <p className="mt-3 text-[12px] text-ink-2">Amount in words: {words}</p> : null}
      </section>

      {upi ? (
        <section className="flex flex-wrap items-center gap-5 border-b border-line py-6">
          <div className="size-28 shrink-0 rounded-md bg-white p-1 ring-1 ring-line" role="img" aria-label={`UPI QR code to pay ${inv.number}`} dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="text-[13px]">
            <p className="font-semibold">Pay by UPI</p>
            <p className="mt-1 text-ink-2">Scan with any UPI app, or pay to</p>
            <p className="num font-medium">{inv.seller.upi_id}</p>
            <p className="mt-1 text-[12px] text-muted">Add {inv.number} as the payment note.</p>
          </div>
        </section>
      ) : null}

      {inv.notes ? <p className="whitespace-pre-line border-b border-line py-5 text-[13px] text-ink-2">{inv.notes}</p> : null}

      <p className="mt-6 text-[11px] text-muted">Created with ScopeFlow · scopeflow.in</p>
    </article>
  );
}
