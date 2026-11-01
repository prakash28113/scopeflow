import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { CURRENCIES, formatMoney, parseAmount } from "@/lib/money";
import { formLineAmount, formQuote, projectFormSchema, toProjectPayload, type ProjectForm as Values } from "@/lib/validation";
import { TEMPLATES, type Template } from "@/lib/templates";
import { useMyPlan } from "@/lib/plans";
import { Link } from "react-router";
import { useAction } from "@/lib/use-action";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { checkScope } from "@/lib/scope-check";
import { PlanLimitCard } from "@/components/plans";

export type FormDeliverable = {
  title: string;
  description: string;
  revisions: number | string;
  priceType: "fixed" | "hourly";
  amount: string;
  hours: string;
  rate: string;
  dueDate?: string;
};
export type FormValues = Omit<Values, "deliverables"> & { deliverables: FormDeliverable[] };

export const emptyDeliverable = (revisions: number | string): FormDeliverable => ({ title: "", description: "", revisions, priceType: "fixed", amount: "", hours: "", rate: "", dueDate: "" });
const emptyMilestone = () => ({ title: "", amount: "", dueDate: "" });

export function ProjectForm({ projectId, initial, showTemplates = false }: { projectId: string | null; initial: FormValues; showTemplates?: boolean }) {
  const [v, setV] = useState<FormValues>(initial);
  const [applied, setApplied] = useState<string | null>(null);
  const plan = useMyPlan(showTemplates);
  const fullLibrary = Boolean(plan.data && plan.data.effective_plan !== "free");
  function applyTemplate(t: Template) {
    setV((p) => ({
      ...p,
      summary: t.summary,
      deliverables: t.deliverables.map((d) => ({ ...emptyDeliverable(d.revisions), title: d.title, description: d.description })),
      exclusions: t.exclusions.join("\n"),
      terms: t.terms,
    }));
    setApplied(t.name);
  }
  const action = useAction();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const fe = action.fieldErrors;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = await action.run(projectFormSchema, v, (f) =>
      supabase.rpc("save_project", { p_project_id: projectId, p: toProjectPayload(f) }),
    );
    if (!id) return;
    await qc.invalidateQueries();
    toast("positive", projectId ? "Scope updated." : "Project created. Review it, then send it to your client.");
    navigate(`/projects/${id as string}`);
  }

  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const setClient = (k: keyof FormValues["client"], val: string) => setV((p) => ({ ...p, client: { ...p.client, [k]: val } }));
  const setDeliverable = (i: number, k: string, val: string) =>
    setV((p) => ({ ...p, deliverables: p.deliverables.map((d, j) => (j === i ? { ...d, [k]: val } : d)) }));
  const setMilestone = (i: number, k: string, val: string) =>
    setV((p) => ({ ...p, milestones: p.milestones.map((m, j) => (j === i ? { ...m, [k]: val } : m)) }));

  const quote = useMemo(() => formQuote(v), [v]);
  const totals = useMemo(() => {
    const budget = v.itemised ? (quote?.total ?? null) : parseAmount(v.budget, v.currency);
    const scheduled = v.milestones.reduce((s, m) => s + (parseAmount(m.amount, v.currency) ?? 0), 0);
    return { budget, scheduled };
  }, [v.budget, v.milestones, v.currency, v.itemised, quote]);

  const defaultRevisions = v.deliverables[0]?.revisions ?? 2;
  const hints = useMemo(() => checkScope(v), [v]);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {action.limit ? <PlanLimitCard limit={action.limit} /> : action.error ? <Alert>{action.error}</Alert> : null}

      {showTemplates ? (
        <Card>
          <CardHeader
            title="Start from a template"
            description={applied ? `${applied} template applied — edit anything below.` : "Optional. Fills in deliverables, exclusions and terms you can edit."}
          />
          <div className="flex flex-wrap gap-2 p-5">
            {TEMPLATES.map((t) => {
              const locked = !t.starter && !fullLibrary;
              return locked ? (
                <Link key={t.id} to="/plan" className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-[13px] text-muted hover:text-ink" title="Part of the full template library (Solo)">
                  {t.name} <span className="rounded bg-sunken px-1.5 text-[11px]">Solo</span>
                </Link>
              ) : (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className={cx("rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors", applied === t.name ? "border-accent bg-accent-soft text-accent-hover" : "border-line-strong hover:border-accent")}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Project" description="What you're making and for whom." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Project title" htmlFor="title" error={fe.title} className="sm:col-span-2">
            <Input id="title" value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Brand identity for Northwind" aria-invalid={!!fe.title} />
          </Field>
          <Field label="Client name" htmlFor="client-name" error={fe["client.name"]}>
            <Input id="client-name" value={v.client.name} onChange={(e) => setClient("name", e.target.value)} aria-invalid={!!fe["client.name"]} />
          </Field>
          <Field label="Client email" htmlFor="client-email" error={fe["client.email"]} hint="For your records. ScopeFlow never emails clients; you share their link.">
            <Input id="client-email" type="email" value={v.client.email} onChange={(e) => setClient("email", e.target.value)} aria-invalid={!!fe["client.email"]} />
          </Field>
          <Field label="Company" htmlFor="client-company" error={fe["client.company"]} hint="Optional">
            <Input id="client-company" value={v.client.company} onChange={(e) => setClient("company", e.target.value)} />
          </Field>
          <div className="hidden sm:block" />
          <Field label="Summary" htmlFor="summary" error={fe.summary} hint="Context the client will see above the deliverables. Optional." className="sm:col-span-2">
            <Textarea id="summary" rows={3} value={v.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Deliverables"
          description="Each deliverable gets its own revision allowance. Requests beyond it are flagged as out of scope."
        />
        <ol className="divide-y divide-line">
          {v.deliverables.map((d, i) => (
            <li key={i} className="grid gap-4 p-5 sm:grid-cols-[1fr_140px_auto] sm:items-start">
              <div className="space-y-3">
                <Field label={`Deliverable ${i + 1}`} htmlFor={`d-title-${i}`} error={fe[`deliverables.${i}.title`]}>
                  <Input
                    id={`d-title-${i}`}
                    value={d.title}
                    onChange={(e) => setDeliverable(i, "title", e.target.value)}
                    placeholder="Primary logo"
                    aria-invalid={!!fe[`deliverables.${i}.title`]}
                  />
                </Field>
                <Textarea
                  aria-label={`Deliverable ${i + 1} details`}
                  rows={2}
                  value={d.description}
                  onChange={(e) => setDeliverable(i, "description", e.target.value)}
                  placeholder="What's included, formats, sizes… (optional)"
                />
                {v.itemised ? (
                  <div className="flex flex-wrap items-end gap-3 rounded-lg bg-sunken/60 p-3">
                    <div role="radiogroup" aria-label={`Deliverable ${i + 1} pricing`} className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
                      {(["fixed", "hourly"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          role="radio"
                          aria-checked={d.priceType === t}
                          onClick={() => setDeliverable(i, "priceType", t)}
                          className={cx("rounded-md px-2.5 py-1 text-[12px] font-medium", d.priceType === t ? "bg-accent-soft text-accent-hover" : "text-muted")}
                        >
                          {t === "fixed" ? "Fixed" : "Hourly"}
                        </button>
                      ))}
                    </div>
                    {d.priceType === "hourly" ? (
                      <>
                        <Field label="Hours" htmlFor={`d-hours-${i}`} error={fe[`deliverables.${i}.hours`]} className="w-24">
                          <Input id={`d-hours-${i}`} inputMode="decimal" value={d.hours} onChange={(e) => setDeliverable(i, "hours", e.target.value)} className="num" />
                        </Field>
                        <Field label={`Rate (${v.currency})`} htmlFor={`d-rate-${i}`} error={fe[`deliverables.${i}.rate`]} className="w-32">
                          <Input id={`d-rate-${i}`} inputMode="decimal" value={d.rate} onChange={(e) => setDeliverable(i, "rate", e.target.value)} className="num" />
                        </Field>
                      </>
                    ) : (
                      <Field label={`Price (${v.currency})`} htmlFor={`d-price-${i}`} error={fe[`deliverables.${i}.amount`]} className="w-36">
                        <Input id={`d-price-${i}`} inputMode="decimal" value={d.amount} onChange={(e) => setDeliverable(i, "amount", e.target.value)} className="num" />
                      </Field>
                    )}
                    <p className="num ml-auto pb-2 text-[13px] font-medium" aria-live="polite">
                      {(() => {
                        const a = formLineAmount(d, v.currency);
                        return a === null ? "—" : formatMoney(a, v.currency);
                      })()}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
                <Field label="Revisions included" htmlFor={`d-rev-${i}`} error={fe[`deliverables.${i}.revisions`]}>
                  <Input
                    id={`d-rev-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={50}
                    value={d.revisions}
                    onChange={(e) => setDeliverable(i, "revisions", e.target.value)}
                    className="num"
                  />
                </Field>
                <Field label="Due (optional)" htmlFor={`d-due-${i}`} error={fe[`deliverables.${i}.dueDate`]}>
                  <Input id={`d-due-${i}`} type="date" value={d.dueDate ?? ""} onChange={(e) => setDeliverable(i, "dueDate", e.target.value)} />
                </Field>
              </div>
              <div className="sm:pt-[26px]">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={v.deliverables.length === 1}
                  onClick={() => set("deliverables", v.deliverables.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-line px-5 py-3">
          {fe.deliverables ? <p className="mb-2 text-[13px] text-danger">{fe.deliverables}</p> : null}
          <Button type="button" variant="secondary" size="sm" onClick={() => set("deliverables", [...v.deliverables, emptyDeliverable(defaultRevisions)])}>
            Add deliverable
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Budget & timeline" />
        <label className="flex items-start gap-3 border-b border-line px-5 py-4 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={v.itemised} onChange={(e) => set("itemised", e.target.checked)} />
          <span>
            <span className="font-medium">Price each deliverable</span>
            <span className="block text-[13px] text-muted">Itemised quote with optional discount and tax (e.g. GST). The total becomes the budget your client approves.</span>
          </span>
        </label>
        {v.itemised ? (
          <div className="grid gap-5 border-b border-line p-5 sm:grid-cols-[1fr_1fr_1fr_1.2fr]">
            <Field label="Discount %" htmlFor="discount" error={fe.discount} hint="Optional">
              <Input id="discount" inputMode="decimal" value={v.discount} onChange={(e) => set("discount", e.target.value)} placeholder="0" className="num" />
            </Field>
            <Field label="Tax name" htmlFor="tax-label" error={fe.taxLabel} hint="e.g. GST">
              <Input id="tax-label" value={v.taxLabel} onChange={(e) => set("taxLabel", e.target.value)} placeholder="GST" maxLength={24} />
            </Field>
            <Field label="Tax %" htmlFor="tax" error={fe.tax} hint="Optional">
              <Input id="tax" inputMode="decimal" value={v.tax} onChange={(e) => set("tax", e.target.value)} placeholder="18" className="num" />
            </Field>
            <dl className="num space-y-1 self-end rounded-lg bg-sunken/60 px-3 py-2 text-[13px]" data-testid="quote-summary">
              {quote ? (
                <>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Subtotal</dt><dd>{formatMoney(quote.subtotal, v.currency)}</dd></div>
                  {quote.discount ? <div className="flex justify-between gap-3"><dt className="text-muted">Discount</dt><dd>−{formatMoney(quote.discount, v.currency)}</dd></div> : null}
                  {quote.tax ? <div className="flex justify-between gap-3"><dt className="text-muted">{v.taxLabel || "Tax"}</dt><dd>{formatMoney(quote.tax, v.currency)}</dd></div> : null}
                  <div className="flex justify-between gap-3 font-semibold"><dt>Total</dt><dd>{formatMoney(quote.total, v.currency)}</dd></div>
                </>
              ) : (
                <p className="text-muted">Price every deliverable to see the total.</p>
              )}
            </dl>
          </div>
        ) : null}
        <div className="grid gap-5 p-5 sm:grid-cols-4">
          <Field label="Currency" htmlFor="currency" error={fe.currency}>
            <Select id="currency" value={v.currency} onChange={(e) => set("currency", e.target.value as Values["currency"])}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          {v.itemised ? (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">Agreed budget</p>
              <p className="num flex h-10 items-center text-base font-semibold">{quote ? formatMoney(quote.total, v.currency) : "—"}</p>
            </div>
          ) : (
            <Field label="Agreed budget" htmlFor="budget" error={fe.budget}>
              <Input id="budget" inputMode="decimal" value={v.budget} onChange={(e) => set("budget", e.target.value)} placeholder="3000" className="num" aria-invalid={!!fe.budget} />
            </Field>
          )}
          <Field label="Start date" htmlFor="start" error={fe.startDate} hint="Optional">
            <Input id="start" type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field label="Due date" htmlFor="due" error={fe.dueDate} hint="Optional">
            <Input id="due" type="date" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Payment milestones"
          description="Optional. Your client approves this schedule together with the scope. ScopeFlow tracks payments; it doesn't process them."
        />
        {v.milestones.length ? (
          <ol className="divide-y divide-line">
            {v.milestones.map((m, i) => (
              <li key={i} className="grid gap-4 p-5 sm:grid-cols-[1fr_160px_170px_auto] sm:items-start">
                <Field label={`Milestone ${i + 1}`} htmlFor={`m-title-${i}`} error={fe[`milestones.${i}.title`]}>
                  <Input id={`m-title-${i}`} value={m.title} onChange={(e) => setMilestone(i, "title", e.target.value)} placeholder="50% deposit" />
                </Field>
                <Field label={`Amount (${v.currency})`} htmlFor={`m-amt-${i}`} error={fe[`milestones.${i}.amount`]}>
                  <Input id={`m-amt-${i}`} inputMode="decimal" value={m.amount} onChange={(e) => setMilestone(i, "amount", e.target.value)} className="num" />
                </Field>
                <Field label="Due" htmlFor={`m-due-${i}`} error={fe[`milestones.${i}.dueDate`]}>
                  <Input id={`m-due-${i}`} type="date" value={m.dueDate} onChange={(e) => setMilestone(i, "dueDate", e.target.value)} />
                </Field>
                <div className="sm:pt-[26px]">
                  <Button type="button" variant="ghost" size="sm" onClick={() => set("milestones", v.milestones.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        <div className={cx("flex flex-wrap items-center justify-between gap-3 px-5 py-3", v.milestones.length > 0 && "border-t border-line")}>
          <Button type="button" variant="secondary" size="sm" onClick={() => set("milestones", [...v.milestones, emptyMilestone()])}>
            Add milestone
          </Button>
          {v.milestones.length > 0 && totals.budget !== null ? (
            <p className={cx("num text-[13px]", totals.scheduled === totals.budget ? "text-positive" : "text-warning")}>
              Scheduled {formatMoney(totals.scheduled, v.currency)} of {formatMoney(totals.budget, v.currency)}
              {totals.scheduled !== totals.budget ? " — doesn't match the budget" : ""}
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Agreement terms"
          description="Your client sees these next to the deliverables and approves them together. They're locked once approved."
        />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field
            label="Not included"
            htmlFor="exclusions"
            error={fe.exclusions}
            hint="One item per line, e.g. Copywriting, Stock photo licences, Printing."
            className="sm:col-span-2"
          >
            <Textarea id="exclusions" rows={4} value={v.exclusions} onChange={(e) => set("exclusions", e.target.value)} placeholder={"Copywriting\nStock photo licences\nPrinting costs"} />
          </Field>
          <Field
            label={`Price per extra revision round (${v.currency})`}
            htmlFor="extra-revision"
            error={fe.extraRevision}
            hint="Shown to the client when they've used their included rounds. Optional."
          >
            <Input id="extra-revision" inputMode="decimal" value={v.extraRevision} onChange={(e) => set("extraRevision", e.target.value)} placeholder="1500" className="num" aria-invalid={!!fe.extraRevision} />
          </Field>
          <div className="hidden sm:block" />
          <Field label="Terms" htmlFor="terms" error={fe.terms} hint="Payment, ownership, cancellation. Optional." className="sm:col-span-2">
            <Textarea id="terms" rows={4} value={v.terms} onChange={(e) => set("terms", e.target.value)} placeholder="50% advance before work starts. Final files are delivered after full payment." />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Scope check"
          description={hints.length ? "Suggestions to make this scope harder to stretch. Optional — you can save anyway." : undefined}
        />
        {hints.length ? (
          <ul className="divide-y divide-line" aria-live="polite">
            {hints.map((h) => (
              <li key={h.message} className="flex gap-3 px-5 py-3 text-[13px] leading-relaxed text-ink-2">
                <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", h.level === "warn" ? "bg-warning" : "bg-line-strong")} aria-hidden />
                <span>
                  <span className="sr-only">{h.level === "warn" ? "Warning: " : "Tip: "}</span>
                  {h.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-[13px] text-positive">Looks solid: clear deliverables, exclusions, terms and limits.</p>
        )}
      </Card>

      <div className="flex items-center justify-end gap-3">
        <SubmitButton pending={action.pending} pendingLabel="Saving…">{projectId ? "Save changes" : "Create project"}</SubmitButton>
      </div>
    </form>
  );
}
