import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardHeader, Field, Input, Select, buttonClass, cx } from "./ui";
import { ActionButton } from "./form-bits";
import { useToast } from "./toast";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { localToday } from "@/lib/upcoming";
import { addDays } from "@/lib/invoice";
import type { Reminder } from "@/lib/reminders";
import { NudgeButton } from "./nudge";

const DOT = { danger: "bg-[#f04438]", warning: "bg-[#f79009]", info: "bg-accent" } as const;
/** Urgency in words as well as colour. */
const URGENCY = {
  danger: { label: "Overdue", cls: "text-danger" },
  warning: { label: "Follow up", cls: "text-warning" },
  info: { label: "Coming up", cls: "text-accent" },
} as const;

/** "Remind me" form: a note, a date and (optionally) a project. */
export function AddFollowUp({ projects, projectId, onAdded }: { projects?: { id: string; title: string }[]; projectId?: string; onAdded?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localToday();
  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Add a follow-up
      </Button>
    );
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const note = String(f.get("note") ?? "").trim();
    if (!note) return setError("Write what to follow up on.");
    setPending(true);
    setError(null);
    const r = await call(() =>
      supabase.rpc("add_follow_up", { p: { note, due_on: String(f.get("due") ?? today), project_id: projectId ?? (String(f.get("project") || "") || null) } }),
    );
    setPending(false);
    if (!r.ok) return setError(r.message);
    setOpen(false);
    toast("positive", "Follow-up saved. It shows in Reminders on the day.");
    await Promise.all([qc.invalidateQueries({ queryKey: ["dashboard"] }), projectId ? qc.invalidateQueries({ queryKey: ["project", projectId] }) : null]);
    onAdded?.();
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-line bg-canvas p-3" data-testid="add-follow-up" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Remind me to" htmlFor="fu-note">
        <Input id="fu-note" name="note" maxLength={300} placeholder="Ask Dana for feedback on the concepts" autoFocus />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Remind me on" htmlFor="fu-due">
          <Input id="fu-due" name="due" type="date" min={today} defaultValue={addDays(today, 2)} />
        </Field>
        {projects && !projectId ? (
          <Field label="Project (optional)" htmlFor="fu-project">
            <Select id="fu-project" name="project" defaultValue="">
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save follow-up"}
        </Button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Dashboard card: everything that needs attention, most urgent first. */
export function RemindersCard({ reminders, projects, className = "mb-8" }: { reminders: Reminder[]; projects: { id: string; title: string }[]; className?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const shown = all ? reminders : reminders.slice(0, 6);
  return (
    <Card className={className}>
      <CardHeader
        title={reminders.length ? `Reminders · ${reminders.length}` : "Reminders"}
        description="Overdue payments, waiting approvals, deadlines and your own follow-ups, most urgent first."
      />
      {reminders.length === 0 ? (
        <p className="flex items-center gap-2.5 px-5 py-4 text-[13px] text-muted">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="text-positive">
            <circle cx="8" cy="8" r="7.5" fill="currentColor" />
            <path d="M5 8.3 7.1 10.4 11 6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          You're all caught up.
        </p>
      ) : (
        <ul className="divide-y divide-line" data-testid="reminders">
          {shown.map((r) => (
            <li key={r.id} className="relative flex items-start gap-3 px-5 py-3 transition-colors hover:bg-canvas">
              <span className={cx("absolute inset-y-2.5 left-0 w-[3px] rounded-r-full", DOT[r.tone])} aria-hidden />
              <Link to={r.href} className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{r.title}</p>
                <p className="text-[12px] text-muted">{r.detail}</p>
              </Link>
              <span className={cx("mt-0.5 hidden shrink-0 text-[12px] font-medium sm:block", URGENCY[r.tone].cls)}>{URGENCY[r.tone].label}</span>
              {r.nudge ? <NudgeButton invoice={r.nudge} compact className="-my-1.5" /> : null}
              {r.followUpId ? (
                <ActionButton
                  size="sm"
                  variant="ghost"
                  aria-label={`Mark “${r.title}” done`}
                  onAction={async () => {
                    const res = await call(() => supabase.rpc("set_follow_up_done", { p_follow_up_id: r.followUpId!, p_done: true }));
                    if (!res.ok) toast("danger", res.message);
                    await qc.invalidateQueries({ queryKey: ["dashboard"] });
                  }}
                >
                  Done
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-3 border-t border-line px-5 py-3">
        {reminders.length > 6 ? (
          <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${reminders.length}`}
          </button>
        ) : null}
        <div className="w-full sm:w-auto sm:min-w-[360px]">
          <AddFollowUp projects={projects} />
        </div>
      </div>
    </Card>
  );
}
