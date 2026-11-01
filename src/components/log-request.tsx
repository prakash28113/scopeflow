import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Select, Textarea, Input, buttonClass } from "./ui";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { localToday } from "@/lib/upcoming";

export const REQUEST_SOURCES = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "call", label: "Phone call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
] as const;
export const sourceLabel = (s: string | undefined | null) =>
  s && s !== "portal" ? (REQUEST_SOURCES.find((x) => x.value === s)?.label ?? "Outside ScopeFlow") : null;

/**
 * Log a request the client made outside ScopeFlow (WhatsApp, a call, email, a meeting).
 * It's checked against the approved scope exactly like a request from the client link.
 */
export function LogRequest({
  projectId,
  deliverables,
  minDate,
  onDone,
}: {
  projectId: string;
  deliverables: { id: string; title: string }[];
  minDate: string;
  onDone: (message: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"revision" | "new_work">("revision");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const today = localToday();

  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Log a request from WhatsApp, call or email
      </Button>
    );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const description = String(f.get("description") ?? "").trim();
    if (!description) return setError("Describe what the client asked for.");
    setPending(true);
    setError(null);
    const r = await call(() =>
      supabase.rpc("log_client_request", {
        p_project_id: projectId,
        p: {
          kind,
          deliverable_id: kind === "revision" ? String(f.get("deliverable")) : null,
          description,
          source: String(f.get("source")),
          received_on: String(f.get("on") || today),
          client_request_id: requestId,
        },
      }),
    );
    setPending(false);
    if (!r.ok) return setError(r.message);
    const res = r.data as { in_scope: boolean; revision_number: number | null; revisions_included: number | null };
    setOpen(false);
    setRequestId(crypto.randomUUID());
    await onDone(
      res.in_scope
        ? `Logged as revision ${res.revision_number} of ${res.revisions_included}.`
        : "Logged. It's outside the agreed scope, so propose a change order before doing it.",
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-line bg-canvas p-3" data-testid="log-request" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="What did they ask for?" htmlFor="lr-kind">
          <Select id="lr-kind" value={kind} onChange={(e) => setKind(e.target.value as "revision" | "new_work")}>
            <option value="revision">A revision to a deliverable</option>
            <option value="new_work">New work (not in the scope)</option>
          </Select>
        </Field>
        {kind === "revision" ? (
          <Field label="Deliverable" htmlFor="lr-del">
            <Select id="lr-del" name="deliverable" defaultValue={deliverables[0]?.id}>
              {deliverables.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <Field label="Their request" htmlFor="lr-desc">
        <Textarea id="lr-desc" name="description" rows={3} maxLength={4000} placeholder="“Can you make the logo blue and add a tagline?”" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="How it arrived" htmlFor="lr-src">
          <Select id="lr-src" name="source" defaultValue="whatsapp">
            {REQUEST_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Received on" htmlFor="lr-on">
          <Input id="lr-on" name="on" type="date" min={minDate} max={today} defaultValue={today} />
        </Field>
      </div>
      <p className="text-[12px] text-muted">It's checked against the approved scope, like requests from the client link, and your client sees it on their page.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Logging…" : "Log request"}
        </Button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
