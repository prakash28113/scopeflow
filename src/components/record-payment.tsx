import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Select, buttonClass } from "./ui";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { formatMoney, parseAmount, toInputAmount } from "@/lib/money";
import { localToday } from "@/lib/upcoming";
import { PAYMENT_METHODS, TDS_HELP, TDS_LABEL, paymentPayload } from "@/lib/payments";

/** Record money received against one payment: amount (part or full), the date it arrived, method, reference. */
export function RecordPayment({
  milestoneId,
  due,
  currency,
  onDone,
}: {
  milestoneId: string;
  /** Still owed on this payment, in minor units. */
  due: number;
  currency: string;
  onDone: (message: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTds, setShowTds] = useState(false);
  const [cashText, setCashText] = useState(() => toInputAmount(due, currency));
  const [tdsText, setTdsText] = useState("");
  const today = localToday();
  const cashNow = cashText.trim() === "" ? 0 : (parseAmount(cashText, currency) ?? 0);
  const tdsNow = tdsText.trim() === "" ? 0 : (parseAmount(tdsText, currency) ?? 0);

  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const checked = paymentPayload(
      { amount: cashText, tds: showTds ? tdsText : "", date: String(f.get("date") ?? ""), method: String(f.get("method")), reference: String(f.get("reference") ?? "") },
      currency,
      due,
      today,
      parseAmount,
    );
    if (!checked.ok) return setError(checked.error);
    setPending(true);
    setError(null);
    const r = await call(() => supabase.rpc("record_payment", { p_milestone_id: milestoneId, p: checked.payload }));
    setPending(false);
    if (!r.ok) return setError(r.message);
    setOpen(false);
    const settled = checked.cash + checked.tds;
    const tdsNote = checked.tds ? ` (TDS ${formatMoney(checked.tds, currency)})` : "";
    await onDone(settled < due ? `Part payment of ${formatMoney(settled, currency)} recorded${tdsNote}.` : `Payment recorded${tdsNote}.`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-3 rounded-lg border border-line bg-canvas p-3" data-testid="record-payment" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Amount (${currency})`} htmlFor={`pa-${milestoneId}`} hint={`${formatMoney(due, currency)} still due`}>
          <Input id={`pa-${milestoneId}`} name="amount" inputMode="decimal" value={cashText} onChange={(e) => setCashText(e.target.value)} autoFocus />
        </Field>
        <Field label="Received on" htmlFor={`pd-${milestoneId}`}>
          <Input id={`pd-${milestoneId}`} name="date" type="date" max={today} defaultValue={today} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Method" htmlFor={`pm-${milestoneId}`}>
          <Select id={`pm-${milestoneId}`} name="method" defaultValue="upi">
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference (optional)" htmlFor={`pr-${milestoneId}`}>
          <Input id={`pr-${milestoneId}`} name="reference" maxLength={200} placeholder="UTR / transaction ID" />
        </Field>
      </div>
      {showTds ? (
        <div className="space-y-1.5" data-testid="tds-field">
          <Field label={TDS_LABEL} htmlFor={`pt-${milestoneId}`} hint={TDS_HELP}>
            <Input id={`pt-${milestoneId}`} name="tds" inputMode="decimal" value={tdsText} onChange={(e) => setTdsText(e.target.value)} placeholder="0" />
          </Field>
          <p className="num text-[12px] text-ink-2" data-testid="tds-sum" aria-live="polite">
            Cash {formatMoney(cashNow, currency)} + TDS {formatMoney(tdsNow, currency)} = {formatMoney(cashNow + tdsNow, currency)} of {formatMoney(due, currency)} due
          </p>
        </div>
      ) : (
        <button type="button" className="min-h-9 text-[13px] font-medium text-accent hover:underline" onClick={() => setShowTds(true)} data-testid="tds-toggle">
          + {TDS_LABEL}
        </button>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save payment"}
        </Button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
