import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { useToast } from "@/components/toast";
import { changeOrderDecisionSchema, revisionRequestSchema, scopeDecisionSchema } from "@/lib/validation";
import { useAction } from "@/lib/use-action";
import { portalRpc } from "@/lib/portal-rpc";
import { formatMoney } from "@/lib/money";

/** Portal form helper: on success, confirm and refresh the portal so the page shows the new state. */
function usePortalAction(token: string) {
  const action = useAction();
  const qc = useQueryClient();
  const toast = useToast();
  const done = async (message?: string) => {
    if (message) toast("positive", message);
    await qc.invalidateQueries({ queryKey: ["portal", token] });
  };
  return { ...action, done };
}

const formData = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget));

function NameField({ defaultName, error, id }: { defaultName: string; error?: string; id: string }) {
  return (
    <Field label="Your name" htmlFor={id} error={error} hint="Recorded with your decision.">
      <Input id={id} name="clientName" defaultValue={defaultName} autoComplete="name" maxLength={120} />
    </Field>
  );
}

function Choice<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx(
            "min-h-11 rounded-lg border px-2 text-[13px] font-medium transition-colors sm:text-sm",
            value === v ? "border-accent bg-accent-soft text-accent-hover" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function ScopeDecisionForm({ token, snapshotId, clientName }: { token: string; snapshotId: string; clientName: string }) {
  const a = usePortalAction(token);
  const [mode, setMode] = useState<"approved" | "rejected">("approved");
  const fe = a.fieldErrors;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await a.run(scopeDecisionSchema, formData(e), (d) =>
      portalRpc("portal_decide_scope", {
        p_token: token,
        p_snapshot_id: d.snapshotId,
        p_decision: d.decision,
        p_client_name: d.clientName,
        p_comment: d.comment,
      }),
    );
    if (res !== undefined) await a.done(mode === "approved" ? "Thank you — the scope is approved." : "Thank you — your feedback was sent.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {a.error ? <Alert>{a.error}</Alert> : null}
      <input type="hidden" name="snapshotId" value={snapshotId} />
      <input type="hidden" name="decision" value={mode} />
      <Choice
        label="Your decision"
        value={mode}
        onChange={setMode}
        options={[
          ["approved", "Approve scope"],
          ["rejected", "Request changes"],
        ]}
      />
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
            <input type="checkbox" name="confirm" className="mt-0.5 size-4 shrink-0 accent-[#3F6FD1]" />
            <span>I approve this scope, budget and payment schedule. I understand work beyond it will be quoted separately as a change order.</span>
          </label>
          {fe.confirm ? <p className="-mt-3 text-[13px] text-danger">{fe.confirm}</p> : null}
        </>
      )}
      <SubmitButton className="w-full sm:w-auto" pending={a.pending} pendingLabel="Submitting…">
        {mode === "approved" ? "Approve scope" : "Send feedback"}
      </SubmitButton>
    </form>
  );
}

export function ChangeOrderDecisionForm({ token, changeOrderId, clientName }: { token: string; changeOrderId: string; clientName: string }) {
  const a = usePortalAction(token);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const fe = a.fieldErrors;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await a.run(changeOrderDecisionSchema, formData(e), (d) =>
      portalRpc("portal_decide_change_order", {
        p_token: token,
        p_change_order_id: d.changeOrderId,
        p_decision: d.decision,
        p_client_name: d.clientName,
        p_comment: d.comment,
      }),
    );
    if (res !== undefined) await a.done(decision === "approved" ? "Change order approved." : "Change order declined.");
  }

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
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {a.error ? <Alert>{a.error}</Alert> : null}
      <input type="hidden" name="changeOrderId" value={changeOrderId} />
      <input type="hidden" name="decision" value={decision} />
      <NameField id={`co-name-${changeOrderId}`} defaultName={clientName} error={fe.clientName} />
      <Field label="Comment" htmlFor={`co-comment-${changeOrderId}`} error={fe.comment} hint="Optional">
        <Textarea id={`co-comment-${changeOrderId}`} name="comment" rows={2} maxLength={4000} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant={decision === "approved" ? "primary" : "danger"} pending={a.pending} pendingLabel="Submitting…">
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
  extraRevisionCents = null,
  currency,
}: {
  token: string;
  clientName: string;
  deliverables: { id: string; title: string; revisions_included: number; revisions_used: number }[];
  /** Agreed price of an extra revision round, from the approved scope. */
  extraRevisionCents?: number | null;
  currency: string;
}) {
  const a = usePortalAction(token);
  const [kind, setKind] = useState<"revision" | "new_work">("revision");
  const [deliverableId, setDeliverableId] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const fe = a.fieldErrors;
  const chosen = deliverables.find((d) => d.id === deliverableId);
  const remaining = chosen ? chosen.revisions_included - chosen.revisions_used : null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await a.run(revisionRequestSchema, formData(e), (d) =>
      portalRpc("portal_request_revision", {
        p_token: token,
        p_kind: d.kind,
        p_deliverable_id: d.kind === "revision" ? d.deliverableId : null,
        p_description: d.description,
        p_client_name: d.clientName,
      }),
    );
    if (res === undefined) return;
    setSent(
      (res as { in_scope: boolean }).in_scope
        ? "Request sent. It's covered by the revisions included in your scope."
        : "Request sent. It goes beyond the agreed scope, so your freelancer may propose a change order with a price before starting.",
    );
    await a.done();
  }

  return (
    <div className="space-y-4">
      {sent ? (
        <Alert tone="positive">
          <div className="flex items-start justify-between gap-3">
            <span>{sent}</span>
            <button
              type="button"
              className="shrink-0 text-[13px] underline"
              onClick={() => {
                setSent(null);
                setDeliverableId("");
                setFormKey((k) => k + 1);
              }}
            >
              New request
            </button>
          </div>
        </Alert>
      ) : null}
      <form key={formKey} onSubmit={onSubmit} className={cx("space-y-5", sent && "hidden")} noValidate>
        {a.error ? <Alert>{a.error}</Alert> : null}
        <input type="hidden" name="kind" value={kind} />
        <Choice
          label="Request type"
          value={kind}
          onChange={setKind}
          options={[
            ["revision", "Revise a deliverable"],
            ["new_work", "Something new"],
          ]}
        />
        {kind === "revision" ? (
          <Field
            label="Deliverable"
            htmlFor="rr-deliverable"
            error={fe.deliverableId}
            hint={
              chosen
                ? remaining! > 0
                  ? `${remaining} of ${chosen.revisions_included} included revision${chosen.revisions_included === 1 ? "" : "s"} left.`
                  : extraRevisionCents !== null && extraRevisionCents !== undefined
                    ? `All included revisions are used. An extra round is ${formatMoney(Number(extraRevisionCents), currency)}, and your freelancer will ask you to approve it before starting.`
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
        <SubmitButton pending={a.pending} pendingLabel="Sending…">
          Send request
        </SubmitButton>
      </form>
    </div>
  );
}
