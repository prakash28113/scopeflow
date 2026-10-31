"use client";

import { useActionState, useState } from "react";
import { Alert, Card, CardHeader, Field, Input, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { formatMoney, parseAmount } from "@/lib/money";
import { addDays, changeOrderAmount, increasePercent, parseHours } from "@/lib/pricing";
import type { ActionState } from "@/lib/validation";
import { createChangeOrder } from "../../../actions";

export function ChangeOrderForm({
  projectId,
  currency,
  contractMinor,
  originalMinor,
  currentDue,
  request,
}: {
  projectId: string;
  currency: string;
  contractMinor: number;
  originalMinor: number;
  currentDue: string | null;
  request: { id: string; description: string; label: string } | null;
}) {
  const [state, action] = useActionState(createChangeOrder.bind(null, projectId), {} as ActionState);
  const fe = state.fieldErrors ?? {};
  const [type, setType] = useState<"fixed" | "hourly">("fixed");
  const [amount, setAmount] = useState("");
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");
  const [days, setDays] = useState("0");

  const price = (() => {
    if (type === "fixed") {
      const a = parseAmount(amount, currency);
      return a === null ? null : changeOrderAmount({ type: "fixed", amountMinor: a });
    }
    const h = parseHours(hours);
    const r = parseAmount(rate, currency);
    return h === null || r === null ? null : changeOrderAmount({ type: "hourly", hoursHundredths: h, rateMinor: r });
  })();
  const d = /^\d+$/.test(days) ? Number(days) : 0;
  const pct = price === null ? null : increasePercent(originalMinor, price);

  return (
    <form action={action} className="space-y-6" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <input type="hidden" name="revisionRequestId" value={request?.id ?? ""} />
      <input type="hidden" name="pricingType" value={type} />

      {request ? (
        <Card>
          <div className="px-5 py-4">
            <p className="text-[12px] font-medium text-muted">Responding to · {request.label}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-2">“{request.description}”</p>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="What's changing" />
        <div className="space-y-5 p-5">
          <Field label="Title" htmlFor="title" error={fe.title}>
            <Input id="title" name="title" placeholder="Business card design" aria-invalid={!!fe.title} />
          </Field>
          <Field label="Description" htmlFor="description" error={fe.description} hint="What's included, so there's no ambiguity later.">
            <Textarea id="description" name="description" rows={4} defaultValue={request?.description ?? ""} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Price & time" />
        <div className="space-y-5 p-5">
          <div role="radiogroup" aria-label="Pricing" className="inline-flex rounded-lg border border-line-strong bg-sunken p-0.5">
            {(["fixed", "hourly"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cx(
                  "h-8 rounded-md px-3.5 text-[13px] font-medium transition-colors",
                  type === t ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink",
                )}
              >
                {t === "fixed" ? "Fixed price" : "Hourly"}
              </button>
            ))}
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            {type === "fixed" ? (
              <Field label={`Price (${currency})`} htmlFor="amount" error={fe.amount} hint="Use 0 for a time-only change.">
                <Input id="amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
              </Field>
            ) : (
              <>
                <Field label="Hours" htmlFor="hours" error={fe.hours}>
                  <Input id="hours" name="hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="3.5" className="num" />
                </Field>
                <Field label={`Hourly rate (${currency})`} htmlFor="rate" error={fe.rate}>
                  <Input id="rate" name="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="num" />
                </Field>
              </>
            )}
            {type === "fixed" ? (
              <>
                <input type="hidden" name="hours" value="" />
                <input type="hidden" name="rate" value="" />
              </>
            ) : (
              <input type="hidden" name="amount" value="" />
            )}
            <Field label="Additional days" htmlFor="additionalDays" error={fe.additionalDays}>
              <Input
                id="additionalDays"
                name="additionalDays"
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="num"
              />
            </Field>
          </div>
        </div>

        <dl className="num grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line bg-sunken/50 px-5 py-4 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-muted">This change</dt>
            <dd className="mt-0.5 text-base font-semibold">{price === null ? "—" : formatMoney(price, currency)}</dd>
          </div>
          <div>
            <dt className="text-muted">New contract total</dt>
            <dd className="mt-0.5 text-base font-semibold">{price === null ? "—" : formatMoney(contractMinor + price, currency)}</dd>
          </div>
          <div>
            <dt className="text-muted">vs. original budget</dt>
            <dd className="mt-0.5 text-base font-semibold">{pct === null ? "—" : `+${pct}%`}</dd>
          </div>
          <div>
            <dt className="text-muted">New due date</dt>
            <dd className="mt-0.5 text-base font-semibold">
              {currentDue ? new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${addDays(currentDue, d)}T00:00:00Z`)) : d ? `+${d} days` : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted">Terms are locked once sent. Nothing is added to the project until your client approves.</p>
        <SubmitButton pendingLabel="Sending…">Send for approval</SubmitButton>
      </div>
    </form>
  );
}
