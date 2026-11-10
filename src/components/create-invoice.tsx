import { timeEnd, timeStart } from "@/lib/timing";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button, Field, Input, Textarea, buttonClass } from "./ui";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { localToday } from "@/lib/upcoming";
import { addDays, percent } from "@/lib/invoice";
import { SAC_SUGGESTIONS, stateName, supplyOf } from "@/lib/gst";

/**
 * "Create invoice" for one payment. The total is the payment amount the client agreed to (it already
 * includes the tax of the quote or change order); the rate splits it into taxable value + tax.
 * CGST + SGST or IGST follows the business's and the client's states (the freelancer can override).
 */
export function CreateInvoice({
  milestoneId,
  taxBps,
  taxLabel,
  sellerState,
  buyerState,
  sacCode,
  hasGstin,
  hasUpi,
  currency,
  defaultOpen = false,
}: {
  /** Open the form straight away (e.g. right after "Invoice the full amount"). */
  defaultOpen?: boolean;
  milestoneId: string;
  taxBps: number | null;
  taxLabel: string | null;
  sellerState?: string | null;
  buyerState?: string | null;
  sacCode?: string | null;
  hasGstin?: boolean;
  hasUpi?: boolean;
  currency?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(defaultOpen);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(taxBps ? percent(taxBps) : "0");
  const [label, setLabel] = useState(taxLabel || "GST");
  const [sac, setSac] = useState(sacCode ?? "");
  const supply = supplyOf(sellerState ?? null, buyerState ?? null);
  const [split, setSplit] = useState(supply.split);
  const today = localToday();
  const rateNum = Number(rate);
  const isGst = /^gst$/i.test(label.trim()) && rateNum > 0;

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
    if (sac.trim() && !/^\d{4,8}$/.test(sac.replace(/\s/g, ""))) return setError("Enter the SAC as 4 to 8 digits, like 998391.");
    setPending(true);
    setError(null);
    timeStart("invoice-create");
    const r = await call(() =>
      supabase.rpc("create_invoice", {
        p_milestone_id: milestoneId,
        p: {
          due_date: String(f.get("due") || "") || null,
          tax_bps: Math.round(rateNum * 100),
          tax_label: label.trim() || "Tax",
          tax_split: isGst && split,
          sac_code: sac.replace(/\s/g, ""),
          notes: String(f.get("notes") ?? ""),
        },
      }),
    );
    timeEnd("invoice-create");
    setPending(false);
    if (!r.ok) return setError(r.message);
    navigate(`/invoices/${r.data as string}`);
  }

  const missing = [!hasGstin && isGst ? "your GSTIN" : null, !hasUpi && currency === "INR" ? "your UPI ID" : null].filter(Boolean);

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-3 rounded-lg border border-line bg-canvas p-3" data-testid="create-invoice">
      {error ? <Alert>{error}</Alert> : null}
      {missing.length ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning" data-testid="invoice-missing-details">
          Add {missing.join(" and ")} in{" "}
          <Link to="/settings" className="font-medium underline">
            Settings
          </Link>{" "}
          to show {missing.length > 1 ? "them" : "it"} on invoices.
        </p>
      ) : null}
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
      {isGst ? (
        <div className="rounded-md border border-line bg-surface px-3 py-2 text-[13px]" data-testid="invoice-tax-type">
          <p>
            <span className="font-medium">{split ? "CGST + SGST" : "IGST"}</span>
            <span className="text-muted">
              {" · "}
              {supply.place ? `place of supply ${stateName(supply.place)}` : "add your state in Settings and the client's state to decide"}
              {sellerState && supply.place ? (split ? " (same state as you)" : ` (you're in ${stateName(sellerState)})`) : ""}
            </span>
          </p>
          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-2">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} className="size-4 shrink-0 accent-[#005DD4]" />
            Show as CGST + SGST (same state). Untick for IGST.
          </label>
        </div>
      ) : null}
      <Field label="SAC code" htmlFor={`sac-${milestoneId}`} hint={sacCode ? "Your default from Settings." : "Required on GST tax invoices. Save a default in Settings."}>
        <Input id={`sac-${milestoneId}`} value={sac} onChange={(e) => setSac(e.target.value)} inputMode="numeric" maxLength={8} placeholder="998391" list={`sac-list-${milestoneId}`} className="num" />
        <datalist id={`sac-list-${milestoneId}`}>
          {SAC_SUGGESTIONS.map(([c, l]) => (
            <option key={c} value={c}>
              {l}
            </option>
          ))}
        </datalist>
      </Field>
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
