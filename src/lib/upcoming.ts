/** Due dates worth a look: anything overdue, plus the next two weeks. */
import { currentDueDate } from "./pricing";
import type { ProjectStatus } from "./types";

export type UpcomingProject = {
  id: string;
  title: string;
  currency: string;
  status: ProjectStatus;
  due_date: string | null;
  extra_days: number;
  milestones: { id?: string; title?: string; amount_cents: number; status: string; due_date?: string | null }[];
};

export type UpcomingItem = {
  key: string;
  projectId: string;
  kind: "project" | "payment";
  label: string;
  projectTitle: string;
  date: string;
  daysAway: number;
  amountCents?: number;
  currency: string;
};

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function upcomingItems(projects: UpcomingProject[], today: string, horizonDays = 14): UpcomingItem[] {
  const out: UpcomingItem[] = [];
  for (const p of projects) {
    const due = currentDueDate(p.due_date, p.extra_days);
    if (due && (p.status === "active" || p.status === "awaiting_approval" || p.status === "changes_requested")) {
      out.push({ key: `p-${p.id}`, projectId: p.id, kind: "project", label: "Project due", projectTitle: p.title, date: due, daysAway: daysBetween(today, due), currency: p.currency });
    }
    // Payment dates only count once the client has agreed to the schedule.
    if (p.status === "active" || p.status === "completed") {
      p.milestones.forEach((m, i) => {
        if (m.status !== "paid" && m.due_date) {
          out.push({
            key: `m-${m.id ?? `${p.id}-${i}`}`,
            projectId: p.id,
            kind: "payment",
            label: m.title || "Payment",
            projectTitle: p.title,
            date: m.due_date,
            daysAway: daysBetween(today, m.due_date),
            amountCents: Number(m.amount_cents),
            currency: p.currency,
          });
        }
      });
    }
  }
  return out.filter((x) => x.daysAway <= horizonDays).sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export function whenLabel(daysAway: number): string {
  if (daysAway < -1) return `${-daysAway} days overdue`;
  if (daysAway === -1) return "1 day overdue";
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}

/** Today's date in the viewer's own time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const off = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - off).toISOString().slice(0, 10);
}
