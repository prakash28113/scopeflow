import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Select, buttonClass } from "./ui";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { formatMoney, parseAmount, toInputAmount } from "@/lib/money";
import { localToday } from "@/lib/upcoming";
import { PAYMENT_METHODS } from "@/lib/payments";

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
  const today = localToday();

  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cents = parseAmount(String(f.get("amount") ?? ""), currency);
    if (!cents || cents <= 0) return setError("Enter the amount received.");
    if (cents > due) return setError(`That's more than the ${formatMoney(due, currency)} still due.`);
    const date = String(f.get("date") ?? "");
    if (!date || date > today) return setError("Enter the date you received it (not in the future).");
    setPending(true);
    setError(null);
    const r = await call(() =>
      supabase.rpc("record_payment", {
        p_milestone_id: milestoneId,
        p: { amount_cents: cents, paid_on: date, method: String(f.get("method")), reference: String(f.get("reference") ?? "") },
      }),
    );
    setPending(false);
    if (!r.ok) return setError(r.message);
    setOpen(false);
    await onDone(cents < due ? `Part payment of ${formatMoney(cents, currency)} recorded.` : "Payment recorded.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-3 rounded-lg border border-line bg-canvas p-3" data-testid="record-payment" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Amount (${currency})`} htmlFor={`pa-${milestoneId}`} hint={`${formatMoney(due, currency)} still due`}>
          <Input id={`pa-${milestoneId}`} name="amount" inputMode="decimal" defaultValue={toInputAmount(due, currency)} autoFocus />
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
