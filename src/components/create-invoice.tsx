import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Field, Input, Textarea, buttonClass } from "./ui";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { localToday } from "@/lib/upcoming";
import { addDays, percent, sameState } from "@/lib/invoice";

/**
 * "Create invoice" for one payment. The total is the payment amount the client agreed to;
 * a tax rate splits it into taxable value + tax. Opens the new invoice when done.
 */
export function CreateInvoice({
  milestoneId,
  taxBps,
  taxLabel,
  sellerGstin,
  buyerGstin,
}: {
  milestoneId: string;
  taxBps: number | null;
  taxLabel: string | null;
  sellerGstin?: string | null;
  buyerGstin?: string | null;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(taxBps ? percent(taxBps) : "0");
  const [label, setLabel] = useState(taxLabel || "GST");
  const today = localToday();
  const same = sameState(sellerGstin, buyerGstin);
  const rateNum = Number(rate);
  const showSplit = /^gst$/i.test(label.trim()) && rateNum > 0;

  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Create invoice
      </Button>
    );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) return setError("Enter a tax rate between 0 and 100.");
    setPending(true);
    setError(null);
    const r = await call(() =>
      supabase.rpc("create_invoice", {
        p_milestone_id: milestoneId,
        p: {
          issue_date: today,
          due_date: String(f.get("due") || "") || null,
          tax_bps: Math.round(rateNum * 100),
          tax_label: label.trim() || "Tax",
          tax_split: showSplit && f.get("split") === "on",
          notes: String(f.get("notes") ?? ""),
        },
      }),
    );
    setPending(false);
    if (!r.ok) return setError(r.message);
    navigate(`/invoices/${r.data as string}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-3 rounded-lg border border-line bg-canvas p-3" data-testid="create-invoice">
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <Field label="Tax name" htmlFor={`tl-${milestoneId}`}>
          <Input id={`tl-${milestoneId}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} placeholder="GST" />
        </Field>
        <Field label="Rate %" htmlFor={`tr-${milestoneId}`}>
          <Input id={`tr-${milestoneId}`} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <p className="text-[12px] text-muted">
        {rateNum > 0 ? `The payment amount includes ${label || "tax"} at ${rate}%. The invoice shows the taxable value and the tax separately.` : "No tax on this invoice. Set a rate if you charge GST."}
      </p>
      {showSplit ? (
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="split" defaultChecked={same ?? true} className="mt-0.5 size-4 shrink-0 accent-[#005DD4]" />
          <span>
            Show as CGST + SGST
            <span className="block text-[12px] text-muted">
              {same === false ? "Your client's GSTIN is in another state, so this is usually IGST: untick and set the tax name to IGST." : "For a client in the same state as you. Untick for IGST."}
            </span>
          </span>
        </label>
      ) : null}
      <Field label="Due date" htmlFor={`due-${milestoneId}`}>
        <Input id={`due-${milestoneId}`} name="due" type="date" min={today} defaultValue={addDays(today, 7)} />
      </Field>
      <Field label="Note on the invoice (optional)" htmlFor={`n-${milestoneId}`}>
        <Textarea id={`n-${milestoneId}`} name="notes" rows={2} maxLength={1000} placeholder="Thank you for your business." />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create invoice"}
        </Button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
