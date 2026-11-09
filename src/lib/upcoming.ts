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
  milestones: { id?: string; title?: string; amount_cents: number; status: string; due_date?: string | null; paid_cents?: number | null }[];
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
            // What is still due: part payments reduce it.
            amountCents: Number(m.amount_cents) - Number(m.paid_cents ?? 0),
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

/** ScopeFlow's calendar: India. The database uses the same day (_today_india()). */
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

/**
 * Today's date as YYYY-MM-DD on the India calendar, wherever the browser is. Default dates in the
 * payment, invoice, request and expense forms (and "overdue") follow this, so a browser in another
 * zone doesn't pick yesterday or tomorrow around midnight IST. Profiles don't store a time zone
 * today; pass one here if they ever do. Dates a person picks are stored exactly as picked.
 */
export function localToday(now = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
