/** In-app reminders, worked out from existing data (tested in tests/unit/reminders.test.ts). */
import { formatMoney } from "./money";

export const FOLLOW_UP_AFTER_DAYS = 3;
export const DEADLINE_SOON_DAYS = 3;
export const LINK_EXPIRY_DAYS = 3;

export type ReminderTone = "danger" | "warning" | "info";
export type Reminder = { id: string; tone: ReminderTone; title: string; detail: string; href: string; sort: number; followUpId?: string };

export type ReminderInput = {
  today: string; // local YYYY-MM-DD
  now: Date;
  projects: { id: string; title: string; status: string; due_date: string | null; extra_days: number; client: string; currency: string }[];
  /** Latest scope version sent, for projects awaiting approval. */
  scopeSent: { project_id: string; created_at: string }[];
  changeOrders: { id: string; number: number; title: string; created_at: string; project_id: string }[];
  invoices: { id: string; number: string; due_date: string | null; amount_cents: number; currency: string; project_id: string; voided_at: string | null; paid: boolean; paid_cents: number }[];
  /** Unpaid payment milestones with a due date (on live projects). */
  payments: { id: string; title: string; due_date: string | null; amount_cents: number; paid_cents: number; status: string; project_id: string; has_invoice: boolean }[];
  links: { project_id: string; expires_at: string; revoked_at: string | null }[];
  followUps: { id: string; due_on: string; note: string; project_id: string | null; done_at: string | null }[];
  /** Deliverables with a due date, on any project (only active ones count). */
  deliverables?: { id: string; title: string; due_date: string | null; progress?: string; project_id: string }[];
};

const dayMs = 86_400_000;
/** Whole days from a (YYYY-MM-DD) to b (YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);
}
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const localDate = (ts: string) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Everything that needs the freelancer's attention, most urgent first. */
export function buildReminders(x: ReminderInput): Reminder[] {
  const out: Reminder[] = [];
  const project = new Map(x.projects.map((p) => [p.id, p]));
  const name = (id: string) => project.get(id)?.title ?? "A project";

  // 1. Scope waiting for the client.
  for (const s of x.scopeSent) {
    const p = project.get(s.project_id);
    if (!p || p.status !== "awaiting_approval") continue;
    const waited = daysBetween(localDate(s.created_at), x.today);
    if (waited >= FOLLOW_UP_AFTER_DAYS)
      out.push({ id: `scope-${p.id}`, tone: "warning", title: `Follow up with ${p.client}`, detail: `Scope for “${p.title}” sent ${days(waited)} ago, still not approved`, href: `/projects/${p.id}`, sort: 20 - waited });
  }
  // 2. Change orders waiting for the client.
  for (const c of x.changeOrders) {
    const waited = daysBetween(localDate(c.created_at), x.today);
    if (waited >= FOLLOW_UP_AFTER_DAYS)
      out.push({ id: `co-${c.id}`, tone: "warning", title: `Change order #${c.number} not answered`, detail: `“${c.title}” on ${name(c.project_id)}, sent ${days(waited)} ago`, href: `/projects/${c.project_id}`, sort: 20 - waited });
  }
  // 3. Overdue invoices (unpaid balance, past due).
  for (const i of x.invoices) {
    if (i.voided_at || i.paid || !i.due_date || i.due_date >= x.today) continue;
    const late = daysBetween(i.due_date, x.today);
    out.push({ id: `inv-${i.id}`, tone: "danger", title: `Invoice ${i.number} is overdue`, detail: `${formatMoney(i.amount_cents - i.paid_cents, i.currency)} due ${days(late)} ago · ${name(i.project_id)}`, href: `/invoices/${i.id}`, sort: -late });
  }
  // 4. Overdue payments without an invoice (invoiced ones are covered above).
  for (const m of x.payments) {
    if (m.status === "paid" || m.has_invoice || !m.due_date || m.due_date >= x.today) continue;
    const p = project.get(m.project_id);
    if (!p) continue;
    const late = daysBetween(m.due_date, x.today);
    out.push({ id: `pay-${m.id}`, tone: "danger", title: `Payment overdue: ${m.title}`, detail: `${formatMoney(m.amount_cents - m.paid_cents, p.currency)} from ${p.client}, due ${days(late)} ago`, href: `/projects/${p.id}`, sort: -late });
  }
  // 5. Project deadlines: overdue or within the next few days.
  for (const p of x.projects) {
    if (p.status !== "active" || !p.due_date) continue;
    const due = addDays(p.due_date, p.extra_days ?? 0);
    const left = daysBetween(x.today, due);
    if (left < 0) out.push({ id: `due-${p.id}`, tone: "danger", title: `“${p.title}” is past its deadline`, detail: `Was due ${days(-left)} ago. Deliver, or agree a new date with a change order`, href: `/projects/${p.id}`, sort: left });
    else if (left <= DEADLINE_SOON_DAYS)
      out.push({ id: `due-${p.id}`, tone: "info", title: `“${p.title}” is due ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${days(left)}`}`, detail: `For ${p.client}`, href: `/projects/${p.id}`, sort: 30 + left });
  }
  // 5b. Deliverables: late, or due within a few days, and not delivered (extensions count).
  for (const d of x.deliverables ?? []) {
    const p = project.get(d.project_id);
    if (!p || p.status !== "active" || !d.due_date || d.progress === "delivered") continue;
    const left = daysBetween(x.today, addDays(d.due_date, p.extra_days ?? 0));
    if (left < 0) out.push({ id: `del-${d.id}`, tone: "danger", title: `“${d.title}” is ${days(-left)} late`, detail: `${p.title} · for ${p.client}`, href: `/projects/${p.id}`, sort: left });
    else if (left <= DEADLINE_SOON_DAYS)
      out.push({ id: `del-${d.id}`, tone: "info", title: `“${d.title}” is due ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${days(left)}`}`, detail: `${p.title} · for ${p.client}`, href: `/projects/${p.id}`, sort: 30 + left });
  }
  // 6. Client links about to expire while the client still has to act.
  for (const l of x.links) {
    const p = project.get(l.project_id);
    if (l.revoked_at || !p || p.status !== "awaiting_approval") continue;
    const left = Math.floor((Date.parse(l.expires_at) - x.now.getTime()) / dayMs);
    if (left >= 0 && left < LINK_EXPIRY_DAYS)
      out.push({ id: `link-${p.id}`, tone: "warning", title: `Client link for “${p.title}” expires ${left === 0 ? "today" : `in ${days(left)}`}`, detail: "Extend it on the project page so your client can still approve", href: `/projects/${p.id}`, sort: 10 + left });
  }
  // 7. The freelancer's own follow-ups that are due.
  for (const f of x.followUps) {
    if (f.done_at || f.due_on > x.today) continue;
    const late = daysBetween(f.due_on, x.today);
    out.push({
      id: `fu-${f.id}`,
      followUpId: f.id,
      tone: late > 0 ? "warning" : "info",
      title: f.note,
      detail: `${late > 0 ? `Due ${days(late)} ago` : "Due today"}${f.project_id ? ` · ${name(f.project_id)}` : ""}`,
      href: f.project_id ? `/projects/${f.project_id}` : "/dashboard",
      sort: late > 0 ? 5 - late : 25,
    });
  }
  return out.sort((a, b) => a.sort - b.sort);
}
