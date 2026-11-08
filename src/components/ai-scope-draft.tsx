import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Field, Input, Textarea, cx } from "./ui";
import { askAi } from "@/lib/ai";
import { scopeDraft, type ScopeDraft } from "@/lib/ai-schemas";
import { selectAll, type DraftSelection } from "@/lib/ai-apply";
import { formatMoney, minorDigits } from "@/lib/money";

const EXAMPLES = [
  "Brand kit for a new café in Hyderabad: logo with 3 revision rounds, colours, menu card. Budget ₹40,000.",
  "5-page website for an architecture studio on Webflow, they'll send the copy. ₹60,000.",
  "10 Instagram posts and 2 reels a month for a saree brand, ₹2,500 per post.",
];

/**
 * "Describe the project": the freelancer writes what they're making in their own words and gets a
 * suggested scope to review. They choose what to keep, answer any open questions, and only then
 * copy it into the normal form below. The form still has to be saved by them.
 */
export function AiScopeDraft({ currency, remaining, onApply }: { currency: string; remaining: number | null; onApply: (draft: ScopeDraft, sel: DraftSelection) => void }) {
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<ScopeDraft | null>(null);
  const [sel, setSel] = useState<DraftSelection | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(remaining);
  const [applied, setApplied] = useState(false);
  const qc = useQueryClient();

  async function run(withAnswers: boolean) {
    setPending(true);
    setError(null);
    setApplied(false);
    const r = await askAi(
      "scope-draft",
      { description, currency, answers: withAnswers && draft ? draft.missingInfo.map((m) => ({ question: m.question, answer: answers[m.question] ?? "" })).filter((a) => a.answer.trim()) : [] },
      scopeDraft,
    );
    setPending(false);
    if (!r.ok) return setError(r.error);
    setDraft(r.result);
    setSel(selectAll(r.result));
    setAnswers({});
    setLeft(r.remaining);
    void qc.invalidateQueries({ queryKey: ["ai-status"] });
  }

  const toggle = (key: "deliverables" | "exclusions" | "assumptions" | "dependencies", i: number) =>
    setSel((s) => (s ? { ...s, [key]: s[key].map((v, j) => (j === i ? !v : v)) } : s));
  const money = (n: number) => formatMoney(Math.round(n * 10 ** minorDigits(currency)), currency);
  const answered = draft ? draft.missingInfo.some((m) => (answers[m.question] ?? "").trim()) : false;

  return (
    <div data-testid="ai-scope-draft">
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">Describe the project</h2>
          <p className="mt-0.5 text-[13px] text-muted">Write it the way you'd explain it to a friend. You'll get a suggested scope to check before anything goes in the form.</p>
        </div>
        <Badge tone="accent">Suggestions only</Badge>
      </div>

      <div className="space-y-3 p-5">
        <Field label="What are you making, for whom, and for how much?" htmlFor="ai-description">
          <Textarea
            id="ai-description"
            rows={3}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Logo and brand basics for a new café, 3 revision rounds, ₹40,000, they want it before launch…"
          />
        </Field>
        {!description ? (
          <div className="flex flex-wrap gap-2" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setDescription(ex)} className="max-w-full truncate rounded-full border border-line-strong px-3 py-1 text-left text-[12px] text-ink-2 hover:border-accent hover:text-ink">
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => run(false)} disabled={pending || description.trim().length < 12}>
            {pending ? "Drafting…" : draft ? "Draft again" : "Suggest a scope"}
          </Button>
          <p className="text-[12px] text-muted">{left !== null ? `${left} suggestions left today. ` : ""}Prices and dates are only filled in when you give them.</p>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {pending ? (
          <div className="space-y-2 pt-1" aria-live="polite">
            <p className="text-[13px] text-muted">Reading your description and drafting deliverables, exclusions and terms…</p>
            <div className="h-2 w-2/3 animate-pulse rounded bg-sunken" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-sunken" />
          </div>
        ) : null}
      </div>

      {draft && sel && !pending ? (
        <div className="border-t border-line bg-sunken/40" data-testid="ai-draft-review">
          <div className="space-y-1 px-5 pt-4">
            <p className="text-[12px] font-medium uppercase tracking-wide text-muted">Suggested scope · untick anything you don't want</p>
            <h3 className="text-[17px] font-semibold">{draft.title}</h3>
            {draft.summary ? <p className="text-[13px] text-ink-2">{draft.summary}</p> : null}
            <p className="num text-[13px] text-ink-2">
              Budget: {draft.budget !== null ? money(draft.budget) : <span className="text-warning">not given — add it in the form</span>}
              {draft.clientName ? ` · Client: ${draft.clientName}` : ""}
            </p>
          </div>

          <Section title="Deliverables">
            {draft.deliverables.map((d, i) => (
              <Check key={i} checked={sel.deliverables[i]} onChange={() => toggle("deliverables", i)} testid="ai-deliverable">
                <span className="font-medium">{d.title}</span>
                <span className="text-muted"> · {d.revisions} revision {d.revisions === 1 ? "round" : "rounds"}{d.amount !== null ? ` · ${money(d.amount)}` : ""}</span>
                {d.description ? <span className="block text-[12px] text-muted">{d.description}</span> : null}
              </Check>
            ))}
          </Section>

          {draft.exclusions.length ? (
            <Section title="Not included">
              {draft.exclusions.map((x, i) => (
                <Check key={i} checked={sel.exclusions[i]} onChange={() => toggle("exclusions", i)}>{x}</Check>
              ))}
            </Section>
          ) : null}

          {draft.assumptions.length || draft.dependencies.length ? (
            <Section title="Added to your terms">
              {draft.assumptions.map((x, i) => (
                <Check key={`a${i}`} checked={sel.assumptions[i]} onChange={() => toggle("assumptions", i)}>
                  <span className="text-muted">Assumes: </span>{x}
                </Check>
              ))}
              {draft.dependencies.map((x, i) => (
                <Check key={`d${i}`} checked={sel.dependencies[i]} onChange={() => toggle("dependencies", i)}>
                  <span className="text-muted">Needs from client: </span>{x}
                </Check>
              ))}
              {draft.terms ? (
                <Check checked={sel.terms} onChange={() => setSel({ ...sel, terms: !sel.terms })}>
                  <span className="text-muted">Terms: </span>{draft.terms}
                </Check>
              ) : null}
            </Section>
          ) : null}

          {draft.paymentSplit.length ? (
            <Section title="Payment split">
              <Check checked={sel.paymentSplit} onChange={() => setSel({ ...sel, paymentSplit: !sel.paymentSplit })}>
                {draft.paymentSplit.map((p) => `${p.title} ${p.percent}%`).join(" · ")}
                {draft.budget === null && !draft.deliverables.every((d) => d.amount !== null) ? <span className="block text-[12px] text-muted">Added once you enter the budget.</span> : null}
              </Check>
            </Section>
          ) : null}

          {draft.phases.length || draft.risks.length ? (
            <div className="grid gap-4 px-5 py-3 sm:grid-cols-2">
              {draft.phases.length ? (
                <div>
                  <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">Rough order of work</p>
                  <ol className="space-y-1 text-[13px]">
                    {draft.phases.map((p, i) => (
                      <li key={i}>
                        <span className="font-medium">{p.name}</span> <span className="text-muted">· about {p.estimate}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {draft.risks.length ? (
                <div>
                  <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">Watch out for</p>
                  <ul className="space-y-1.5 text-[13px]">
                    {draft.risks.map((r, i) => (
                      <li key={i}>
                        {r.risk} <span className="text-muted">— {r.mitigation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {draft.missingInfo.length ? (
            <div className="space-y-3 border-t border-line px-5 py-4" data-testid="ai-questions">
              <p className="text-[13px] font-medium">Worth settling before you send it</p>
              {draft.missingInfo.map((m, i) => (
                <Field key={m.question} label={m.question} htmlFor={`ai-q-${i}`} hint={m.why}>
                  <Input id={`ai-q-${i}`} value={answers[m.question] ?? ""} onChange={(e) => setAnswers({ ...answers, [m.question]: e.target.value })} placeholder="Your answer (optional)" />
                </Field>
              ))}
              <Button type="button" variant="secondary" size="sm" disabled={!answered || pending} onClick={() => run(true)}>
                Update the suggestion with my answers
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <p className="text-[12px] text-muted">Copies your picks into the form below. You can still change everything, and nothing is saved until you create the project.</p>
            <Button
              type="button"
              disabled={!sel.deliverables.some(Boolean)}
              onClick={() => {
                onApply(draft, sel);
                setApplied(true);
              }}
            >
              Use in the form
            </Button>
          </div>
          {applied ? (
            <div className="px-5 pb-4">
              <Alert tone="positive">Added to the form below. Check the client's email, prices and dates, then create the project.</Alert>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3">
      <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">{title}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Check({ checked, onChange, children, testid }: { checked: boolean; onChange: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <li>
      <label className={cx("flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 text-[13px] leading-relaxed hover:bg-surface", !checked && "opacity-55")} data-testid={testid}>
        <input type="checkbox" className="mt-[3px] size-4 shrink-0 accent-[var(--color-accent)]" checked={checked} onChange={onChange} />
        <span className="min-w-0">{children}</span>
      </label>
    </li>
  );
}
