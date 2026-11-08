import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Tag, Textarea, cx } from "./ui";
import { askAi } from "@/lib/ai";
import { changeImpactResult, type ChangeImpactResult } from "@/lib/ai-schemas";
import { formatMoney, minorDigits } from "@/lib/money";

const KIND: Record<ChangeImpactResult["kind"], { label: string; tone: "accent" | "warning" | "positive" | "neutral" }> = {
  within_scope: { label: "Covered by the scope", tone: "positive" },
  uses_revision: { label: "Uses a revision round", tone: "accent" },
  new_work: { label: "New work: needs a change order", tone: "warning" },
  unclear: { label: "Unclear: ask the client first", tone: "neutral" },
};

/** What a change order starts with when opened from a suggestion (the freelancer edits and sends it). */
export type AiChangeOrderDraft = { title: string; description: string; amount: string };

/**
 * Checks a client's request against the approved scope and explains the impact: whether it's
 * covered, uses a revision round or is new work, what it touches, and what it would cost at the
 * freelancer's own saved prices. It changes nothing; "Draft change order" only opens the normal
 * change-order form with the suggestion filled in.
 */
export function AiImpact({ projectId, currency, request, buttonLabel = "Check against the scope" }: { projectId: string; currency: string; request?: { id: string; description: string }; buttonLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(request?.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChangeImpactResult | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const money = (n: number) => formatMoney(Math.round(n * 10 ** minorDigits(currency)), currency);

  async function run() {
    setPending(true);
    setError(null);
    setCopied(false);
    const r = await askAi("change-impact", { projectId, request: text, requestId: request?.id ?? null }, changeImpactResult);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setResult(r.result);
    void qc.invalidateQueries({ queryKey: ["ai-status"] });
  }

  function draftChangeOrder(res: ChangeImpactResult) {
    const title = res.kind === "uses_revision" ? "Extra revision round" : (res.newWork[0]?.title ?? text.split(/[.\n]/)[0]).slice(0, 80);
    const description = [res.explanation, ...res.newWork.map((w) => `- ${w.title}${w.quantity !== null ? ` (${w.quantity}${w.unit ? ` ${w.unit}` : ""})` : ""}${w.description ? `: ${w.description}` : ""}`)].filter(Boolean).join("\n");
    const priced = res.estimate.lines.filter((l) => (l.amount ?? 0) > 0);
    const amount = res.estimate.total !== null && res.estimate.total > 0 ? String(res.estimate.total) : priced.length === 1 ? String(priced[0].amount) : "";
    const draft: AiChangeOrderDraft = { title, description: description.slice(0, 2000), amount };
    navigate(`/projects/${projectId}/change-orders/new${request ? `?request=${request.id}` : ""}`, { state: { aiDraft: draft } });
  }

  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="ai-impact-open">
        {buttonLabel}
      </Button>
    );

  return (
    <div className="w-full space-y-3 rounded-lg border border-line bg-sunken/40 p-3.5" data-testid="ai-impact">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium">Check against the approved scope</p>
        <button type="button" className="text-[12px] text-muted hover:text-ink" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <Textarea aria-label="What the client asked for" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="The client wants three more pages and a contact form…" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending || text.trim().length < 4} onClick={run}>
          {pending ? "Checking…" : result ? "Check again" : "Check impact"}
        </Button>
        <p className="text-[12px] text-muted">A suggestion only. Nothing on the project changes.</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {result && !pending ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-3.5 text-[13px]" data-testid="ai-impact-result">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={KIND[result.kind].tone}>{KIND[result.kind].label}</Tag>
            {result.affectedDeliverables.map((d) => (
              <Tag key={d}>{d}</Tag>
            ))}
          </div>
          {result.explanation ? <p className="leading-relaxed text-ink-2">{result.explanation}</p> : null}
          {result.newWork.length ? (
            <div>
              <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted">Not in the approved scope</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {result.newWork.map((w, i) => (
                  <li key={i}>
                    {w.title}
                    {w.quantity !== null ? ` · ${w.quantity}${w.unit ? ` ${w.unit}` : ""}` : ""}
                    {w.description ? <span className="text-muted"> — {w.description}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.estimate.lines.length ? (
            <div>
              <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted">Cost at your prices</p>
              <dl className="num space-y-1">
                {result.estimate.lines.map((l, i) => (
                  <div key={i} className="flex flex-wrap justify-between gap-x-3">
                    <dt>
                      {l.label}
                      <span className="block text-[12px] text-muted">{l.basis}</span>
                    </dt>
                    <dd className={cx("font-medium", l.amount === null && "text-warning")}>{l.amount === null ? "Set a price" : l.amount === 0 ? "Included" : money(l.amount)}</dd>
                  </div>
                ))}
                {result.estimate.total !== null && result.estimate.lines.length > 1 ? (
                  <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold">
                    <dt>Total before tax</dt>
                    <dd>{money(result.estimate.total)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}
          {result.timelineImpact ? (
            <p>
              <span className="font-medium">Timeline: </span>
              <span className="text-ink-2">{result.timelineImpact}</span>
            </p>
          ) : null}
          {result.questionsForClient.length ? (
            <div>
              <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted">Ask the client</p>
              <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
                {result.questionsForClient.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.clientMessage ? (
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted">A reply you could send</p>
              <p className="whitespace-pre-line rounded-md bg-sunken/60 p-2.5 text-ink-2" data-testid="ai-client-message">{result.clientMessage}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {result.kind === "new_work" || result.kind === "unclear" || result.estimate.lines.some((l) => (l.amount ?? 0) > 0) ? (
              <Button type="button" size="sm" onClick={() => draftChangeOrder(result)}>
                Draft change order
              </Button>
            ) : null}
            {result.clientMessage ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(result.clientMessage)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false))
                }
              >
                {copied ? "Copied" : "Copy reply"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
