/** Reminders worked out from the dashboard data; shared by the dashboard, the notification centre and the bell. */
import { useDashboard } from "./queries";
import { buildReminders, type Reminder } from "./reminders";
import { localToday } from "./upcoming";

export type DashboardData = NonNullable<ReturnType<typeof useDashboard>["data"]>;

export function remindersFrom(d: DashboardData, now = new Date()): Reminder[] {
  const invoicedMilestones = new Set(d.invoices.map((i) => i.milestone_id));
  return buildReminders({
    today: localToday(),
    now,
    projects: d.projects.map((p) => ({ id: p.id, title: p.title, status: p.status, due_date: p.due_date, extra_days: p.extra_days, client: p.clients.company || p.clients.name, currency: p.currency })),
    scopeSent: [...new Map([...d.snapshots].reverse().map((s) => [s.project_id, s])).values()],
    changeOrders: d.changeOrders,
    invoices: d.invoices.map((i) => ({ ...i, paid: i.milestones?.status === "paid", paid_cents: Number(i.milestones?.paid_cents ?? 0) })),
    payments: d.projects
      .filter((p) => p.status === "active" || p.status === "completed")
      .flatMap((p) => p.milestones.map((m) => ({ ...m, paid_cents: Number(m.paid_cents ?? 0), project_id: p.id, has_invoice: invoicedMilestones.has(m.id) }))),
    links: d.links,
    followUps: d.followUps,
    deliverables: d.projects.flatMap((p) => (p.deliverables ?? []).map((x) => ({ ...x, project_id: p.id }))),
  });
}

/** Overdue or waiting items (not the informational "due soon" ones): what the bell's red dot counts. */
export const needsAttention = (rs: Reminder[]) => rs.filter((r) => r.tone !== "info").length;

/** Projects you can attach a follow-up to. */
export const openProjects = (d: DashboardData) => d.projects.filter((p) => p.status !== "cancelled" && p.status !== "completed").map((p) => ({ id: p.id, title: p.title }));
