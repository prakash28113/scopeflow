"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import type { ActionState } from "@/lib/validation";
import { decideChangeOrder, decideScope, requestRevision } from "./actions";

const init = {} as ActionState;

function NameField({ defaultName, error, id }: { defaultName: string; error?: string; id: string }) {
  return (
    <Field label="Your name" htmlFor={id} error={error} hint="Recorded with your decision.">
      <Input id={id} name="clientName" defaultValue={defaultName} autoComplete="name" maxLength={120} />
    </Field>
  );
}

export function ScopeDecisionForm({ token, snapshotId, clientName }: { token: string; snapshotId: string; clientName: string }) {
  const [state, action] = useActionState(decideScope.bind(null, token), init);
  const [mode, setMode] = useState<"approved" | "rejected">("approved");
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <Alert tone="positive">{state.message}</Alert>;

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <input type="hidden" name="snapshotId" value={snapshotId} />
      <input type="hidden" name="decision" value={mode} />

      <div role="radiogroup" aria-label="Your decision" className="grid grid-cols-2 gap-2">
        {(
          [
            ["approved", "Approve scope"],
            ["rejected", "Request changes"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            onClick={() => setMode(v)}
            className={cx(
              "h-11 rounded-lg border text-sm font-medium transition-colors",
              mode === v ? "border-accent bg-accent-soft text-accent-hover" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <NameField id="scope-name" defaultName={clientName} error={fe.clientName} />

      {mode === "rejected" ? (
        <Field label="What should change?" htmlFor="scope-comment" error={fe.comment}>
          <Textarea id="scope-comment" name="comment" rows={4} maxLength={4000} placeholder="e.g. Please add social media templates and move the deadline to the 15th." />
        </Field>
      ) : (
        <>
          <Field label="Comment" htmlFor="scope-comment" error={fe.comment} hint="Optional">
            <Textarea id="scope-comment" name="comment" rows={2} maxLength={4000} />
          </Field>
          <label className="flex items-start gap-3 rounded-lg border border-line bg-sunken/60 p-3.5 text-[13px] text-ink-2">
            <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-[#3F6FD1]" />
            <span>
              I approve this scope, budget and payment schedule. I understand work beyond it will be quoted separately as a change order.
            </span>
          </label>
          {fe.confirm ? <p className="-mt-3 text-[13px] text-danger">{fe.confirm}</p> : null}
        </>
      )}

      <SubmitButton className="w-full sm:w-auto" pendingLabel="Submitting…">
        {mode === "approved" ? "Approve scope" : "Send feedback"}
      </SubmitButton>
    </form>
  );
}

export function ChangeOrderDecisionForm({ token, changeOrderId, clientName }: { token: string; changeOrderId: string; clientName: string }) {
  const [state, action] = useActionState(decideChangeOrder.bind(null, token), init);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <Alert tone="positive">{state.message}</Alert>;

  if (!decision) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setDecision("approved")}>
          Approve
        </Button>
        <Button type="button" variant="secondary" onClick={() => setDecision("rejected")}>
          Decline
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <input type="hidden" name="changeOrderId" value={changeOrderId} />
      <input type="hidden" name="decision" value={decision} />
      <NameField id={`co-name-${changeOrderId}`} defaultName={clientName} error={fe.clientName} />
      <Field label="Comment" htmlFor={`co-comment-${changeOrderId}`} error={fe.comment} hint="Optional">
        <Textarea id={`co-comment-${changeOrderId}`} name="comment" rows={2} maxLength={4000} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant={decision === "approved" ? "primary" : "danger"} pendingLabel="Submitting…">
          {decision === "approved" ? "Confirm approval" : "Confirm decline"}
        </SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setDecision(null)}>
          Back
        </Button>
      </div>
    </form>
  );
}

export function RevisionRequestForm({
  token,
  clientName,
  deliverables,
}: {
  token: string;
  clientName: string;
  deliverables: { id: string; title: string; revisions_included: number; revisions_used: number }[];
}) {
  const [state, action] = useActionState(requestRevision.bind(null, token), init);
  const [kind, setKind] = useState<"revision" | "new_work">("revision");
  const [deliverableId, setDeliverableId] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [dismissed, setDismissed] = useState<ActionState | null>(null);
  const showSuccess = state.ok && state !== dismissed;
  const fe = state.fieldErrors ?? {};
  const chosen = deliverables.find((d) => d.id === deliverableId);
  const remaining = chosen ? chosen.revisions_included - chosen.revisions_used : null;

  return (
    <div className="space-y-4">
      {showSuccess ? (
        <Alert tone="positive">
          <div className="flex items-start justify-between gap-3">
            <span>{state.message}</span>
            <button
              type="button"
              className="shrink-0 text-[13px] underline"
              onClick={() => {
                setDismissed(state);
                setFormKey((k) => k + 1);
              }}
            >
              New request
            </button>
          </div>
        </Alert>
      ) : null}
      <form key={formKey} action={action} className={cx("space-y-5", showSuccess && "hidden")} noValidate>
        {state.error ? <Alert>{state.error}</Alert> : null}
        <input type="hidden" name="kind" value={kind} />
        <div role="radiogroup" aria-label="Request type" className="grid grid-cols-2 gap-2">
          {(
            [
              ["revision", "Revise a deliverable"],
              ["new_work", "Something new"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={kind === v}
              onClick={() => setKind(v)}
              className={cx(
                "h-11 rounded-lg border px-2 text-[13px] font-medium transition-colors",
                kind === v ? "border-accent bg-accent-soft text-accent-hover" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {kind === "revision" ? (
          <Field
            label="Deliverable"
            htmlFor="rr-deliverable"
            error={fe.deliverableId}
            hint={
              chosen
                ? remaining! > 0
                  ? `${remaining} of ${chosen.revisions_included} included revision${chosen.revisions_included === 1 ? "" : "s"} left.`
                  : "All included revisions are used — this one may be quoted as a change order."
                : undefined
            }
          >
            <Select id="rr-deliverable" name="deliverableId" value={deliverableId} onChange={(e) => setDeliverableId(e.target.value)}>
              <option value="">Choose…</option>
              {deliverables.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <input type="hidden" name="deliverableId" value="" />
            <p className="text-[13px] text-muted">
              New work isn&apos;t part of the approved scope. Your freelancer will reply with a change order (price and timing) for you to approve.
            </p>
          </>
        )}

        <Field label="Describe the change" htmlFor="rr-description" error={fe.description}>
          <Textarea id="rr-description" name="description" rows={4} maxLength={4000} />
        </Field>
        <NameField id="rr-name" defaultName={clientName} error={fe.clientName} />
        <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
      </form>
    </div>
  );
}
