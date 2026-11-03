import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, buttonClass } from "./ui";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { formatMoney, parseAmount, toInputAmount } from "@/lib/money";
import { addDays } from "@/lib/invoice";
import { localToday } from "@/lib/upcoming";

/**
 * After approval: schedule (part of) the contract that no payment covers yet, so it can be invoiced
 * and recorded. The agreed total doesn't change, only how it's split into payments.
 */
export function AddPayment({
  projectId,
  currency,
  uncovered,
  onDone,
}: {
  projectId: string;
  currency: string;
  /** Contract total minus every scheduled payment, in minor units. */
  uncovered: number;
  onDone: (message: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localToday();

  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
        Add payment to invoice it
      </Button>
    );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cents = parseAmount(String(f.get("amount") ?? ""), currency);
    if (!cents || cents <= 0) return setError("Enter an amount.");
    if (cents > uncovered) return setError(`Only ${formatMoney(uncovered, currency)} isn't covered by a payment yet.`);
    setPending(true);
    setError(null);
    const r = await call(() =>
      supabase.rpc("add_payment", {
        p_project_id: projectId,
        p: { title: String(f.get("title") ?? ""), amount_cents: cents, due_date: String(f.get("due") || "") || null },
      }),
    );
    setPending(false);
    if (!r.ok) return setError(r.message);
    setOpen(false);
    await onDone("Payment added. You can create its invoice now.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-3 rounded-lg border border-line bg-canvas p-3" data-testid="add-payment" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Payment name" htmlFor={`ap-t-${projectId}`}>
        <Input id={`ap-t-${projectId}`} name="title" maxLength={200} defaultValue="Balance payment" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Amount (${currency})`} htmlFor={`ap-a-${projectId}`} hint={`Up to ${formatMoney(uncovered, currency)}`}>
          <Input id={`ap-a-${projectId}`} name="amount" inputMode="decimal" defaultValue={toInputAmount(uncovered, currency)} className="num" />
        </Field>
        <Field label="Due date (optional)" htmlFor={`ap-d-${projectId}`}>
          <Input id={`ap-d-${projectId}`} name="due" type="date" defaultValue={addDays(today, 7)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add payment"}
        </Button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
