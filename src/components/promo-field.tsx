import { useState } from "react";
import { Alert, Button, Input } from "@/components/ui";
import { checkPromo, type PromoCheck } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import type { Interval, PlanId } from "@/lib/plans";

const whole = (minor: number, currency: string) => formatMoney(minor, currency).replace(/\.00$/, "");

/** What an applied code means, in plain words. */
export function promoSummary(p: Extract<PromoCheck, { valid: true }>): string {
  const months = p.cycles === 1 ? "first month" : `first ${p.cycles} months`;
  return `Code ${p.code} applied: ${whole(p.price_cents, p.currency)} a month for your ${months}, then ${whole(p.full_price_cents, p.currency)} a month. Razorpay shows the discount in the payment window.`;
}

/**
 * "Have a promo code?" on the Plan page. Checking a code takes no use of it; a use is taken only when
 * the payment window opens. The server checks the code again then, so what this shows is a preview.
 */
export function PromoField({ plan, interval, applied, onApplied }: { plan: PlanId; interval: Interval; applied: string | null; onApplied: (code: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PromoCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function apply() {
    const code = text.trim();
    if (!code || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await checkPromo(plan, interval, code);
      setResult(r);
      onApplied(r.valid ? r.code : null);
    } catch (e) {
      setResult(null);
      onApplied(null);
      setFailed(e instanceof Error ? e.message : "Couldn't check that code. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function remove() {
    setResult(null);
    setFailed(null);
    setText("");
    onApplied(null);
  }

  if (!open && !applied) {
    return (
      <button type="button" className="mb-4 text-[13px] font-medium text-accent hover:underline" onClick={() => setOpen(true)} data-testid="promo-open">
        Have a promo code?
      </button>
    );
  }
  return (
    <div className="mb-5 max-w-md" data-testid="promo-field">
      {applied && result?.valid ? (
        <div className="space-y-2">
          <Alert tone="positive">{promoSummary(result)}</Alert>
          <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={remove}>
            Remove code
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          <label htmlFor="promo-code" className="mb-1 block text-[13px] font-medium">
            Promo code
          </label>
          <div className="flex gap-2">
            <Input id="promo-code" value={text} onChange={(e) => setText(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} aria-invalid={Boolean(failed || (result && !result.valid))} />
            <Button type="submit" variant="secondary" disabled={busy || !text.trim()}>
              {busy ? "Checking…" : "Apply"}
            </Button>
          </div>
          {result && !result.valid ? (
            <p className="mt-2 text-[13px] text-danger" role="alert" data-testid="promo-error">
              {result.reason}
            </p>
          ) : null}
          {failed ? (
            <p className="mt-2 text-[13px] text-danger" role="alert" data-testid="promo-error">
              {failed}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
