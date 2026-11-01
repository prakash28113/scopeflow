import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { CURRENCIES, formatMoney, parseAmount } from "@/lib/money";
import { projectFormSchema, toProjectPayload, type ProjectForm as Values } from "@/lib/validation";
import { useAction } from "@/lib/use-action";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { checkScope } from "@/lib/scope-check";

export type FormValues = Omit<Values, "deliverables"> & {
  deliverables: { title: string; description: string; revisions: number | string }[];
};

const emptyDeliverable = (revisions: number | string) => ({ title: "", description: "", revisions });
const emptyMilestone = () => ({ title: "", amount: "", dueDate: "" });

export function ProjectForm({ projectId, initial }: { projectId: string | null; initial: FormValues }) {
  const [v, setV] = useState<FormValues>(initial);
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

  const totals = useMemo(() => {
    const budget = parseAmount(v.budget, v.currency);
    const scheduled = v.milestones.reduce((s, m) => s + (parseAmount(m.amount, v.currency) ?? 0), 0);
    return { budget, scheduled };
  }, [v.budget, v.milestones, v.currency]);

  const defaultRevisions = v.deliverables[0]?.revisions ?? 2;
  const hints = useMemo(() => checkScope(v), [v]);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {action.error ? <Alert>{action.error}</Alert> : null}

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
              </div>
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
        <div className="grid gap-5 p-5 sm:grid-cols-4">
          <Field label="Currency" htmlFor="currency" error={fe.currency}>
            <Select id="currency" value={v.currency} onChange={(e) => set("currency", e.target.value as Values["currency"])}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Agreed budget" htmlFor="budget" error={fe.budget}>
            <Input id="budget" inputMode="decimal" value={v.budget} onChange={(e) => set("budget", e.target.value)} placeholder="3000" className="num" aria-invalid={!!fe.budget} />
          </Field>
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
