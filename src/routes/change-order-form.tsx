import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Card, CardHeader, Field, Input, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { formatMoney, parseAmount } from "@/lib/money";
import { addDays, changeOrderAmount, increasePercent, parseHours, withTax } from "@/lib/pricing";
import { bpsToPercent, parsePercent } from "@/lib/quote";
import { changeOrderSchema } from "@/lib/validation";
import { useAction } from "@/lib/use-action";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

export function ChangeOrderForm({
  projectId,
  currency,
  contractMinor,
  originalMinor,
  currentDue,
  request,
  suggestedAmount = "",
  taxBps = 0,
  taxLabel = null,
  suggestedTitle = "",
}: {
  projectId: string;
  currency: string;
  contractMinor: number;
  originalMinor: number;
  currentDue: string | null;
  request: { id: string; description: string; label: string } | null;
  /** Pre-fills the fixed price, e.g. the agreed price of an extra revision round. */
  suggestedAmount?: string;
  /** The project's tax (from the approved quote): change orders use the same basis. */
  taxBps?: number | null;
  taxLabel?: string | null;
  suggestedTitle?: string;
}) {
  const action = useAction();
  const fe = action.fieldErrors;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = await action.run(changeOrderSchema(currency), Object.fromEntries(new FormData(e.currentTarget)), (p) =>
      supabase.rpc("create_change_order", { p_project_id: projectId, p }),
    );
    if (!id) return;
    await qc.invalidateQueries();
    toast("positive", "Change order sent. Your client can approve it from their project link.");
    navigate(`/projects/${projectId}`);
  }
  const [type, setType] = useState<"fixed" | "hourly">("fixed");
  const [amount, setAmount] = useState(suggestedAmount);
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");
  const [days, setDays] = useState("0");
  const [tax, setTax] = useState(bpsToPercent(taxBps));
  const label = (taxLabel || "GST").slice(0, 24);

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
  const bps = tax.trim() ? parsePercent(tax) : 0;
  const totals = price === null || bps === null ? null : withTax(price, bps);
  const pct = totals === null ? null : increasePercent(originalMinor, totals.total);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {action.error ? <Alert>{action.error}</Alert> : null}
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
            <Input id="title" name="title" placeholder="Business card design" defaultValue={suggestedTitle} aria-invalid={!!fe.title} />
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
            <Field label={`${label} (%)`} htmlFor="tax" error={fe.tax} hint={taxBps ? "Same as the approved quote. Use 0 for none." : "Use 0 for none."}>
              <Input id="tax" name="tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" className="num" />
            </Field>
            <input type="hidden" name="taxLabel" value={label} />
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

        <dl className="num grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line bg-sunken/50 px-5 py-4 text-[13px] sm:grid-cols-4" data-testid="co-totals">
          <div>
            <dt className="text-muted">Price</dt>
            <dd className="mt-0.5 text-base font-semibold">{totals === null ? "—" : formatMoney(totals.subtotal, currency)}</dd>
          </div>
          <div>
            <dt className="text-muted">{bps ? `${label} ${bpsToPercent(bps)}%` : label}</dt>
            <dd className="mt-0.5 text-base font-semibold">{totals === null ? "—" : formatMoney(totals.tax, currency)}</dd>
          </div>
          <div>
            <dt className="text-muted">Client pays</dt>
            <dd className="mt-0.5 text-base font-semibold">{totals === null ? "—" : formatMoney(totals.total, currency)}</dd>
          </div>
          <div>
            <dt className="text-muted">New contract total</dt>
            <dd className="mt-0.5 text-base font-semibold">{totals === null ? "—" : formatMoney(contractMinor + totals.total, currency)}</dd>
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
        <SubmitButton pending={action.pending} pendingLabel="Sending…">Send for approval</SubmitButton>
      </div>
    </form>
  );
}
