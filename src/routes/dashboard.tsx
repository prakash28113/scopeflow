import type { ReactNode } from "react";
import { Link } from "react-router";
import { currentDueDate, received } from "@/lib/pricing";
import { Alert, Card, CardHeader, EmptyState, Figure, Figures, LinkButton, Meter, PageHeader, StatusBadge, cx } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProfile } from "@/lib/auth";
import { useDashboard } from "@/lib/queries";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, STATUS_LABEL } from "@/lib/format";
import { localToday, upcomingItems, whenLabel } from "@/lib/upcoming";
import { lastMonths, monthLabel, monthOf } from "@/lib/analytics";
import type { ProjectStatus } from "@/lib/types";
import { remindersFrom, openProjects } from "@/lib/use-reminders";
import { RemindersCard } from "@/components/reminders";

const OPEN: ProjectStatus[] = ["draft", "awaiting_approval", "changes_requested", "active"];
/** Order projects by how much they need you: replies first, then live work, then drafts. */
const PRIORITY: Record<ProjectStatus, number> = { changes_requested: 0, awaiting_approval: 1, active: 2, draft: 3, completed: 4, cancelled: 5 };

function sumByCurrency(items: { currency: string; amount: number }[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.currency, (m.get(i.currency) ?? 0) + i.amount);
  return [...m.entries()].filter(([, v]) => v !== 0);
}

export default function Dashboard() {
  const profile = useProfile();
  const q = useDashboard();
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load your projects. Please refresh.</Alert>;
  const { projects, changeOrders, revisions, activity, payments } = q.data;
  const reminders = remindersFrom(q.data);
  const today = localToday();

  const open = projects.filter((p) => OPEN.includes(p.status));
  const awaitingScope = projects.filter((p) => p.status === "awaiting_approval");
  const live = projects.filter((p) => p.status === "active" || p.status === "completed");
  const paidOf = (p: (typeof projects)[number]) => p.milestones.reduce((s, m) => s + received(m), 0);
  const contractOf = (p: (typeof projects)[number]) => Number(p.budget_cents) + Number(p.approved_extras_cents);
  const outstanding = sumByCurrency(live.map((p) => ({ currency: p.currency, amount: contractOf(p) - paidOf(p) })));
  const collected = sumByCurrency(live.map((p) => ({ currency: p.currency, amount: paidOf(p) })));
  const firstName = (profile.data?.full_name ?? "").split(" ")[0];
  const pendingCount = awaitingScope.length + changeOrders.length;
  const upcoming = upcomingItems(projects, today);
  const overduePayments = upcoming.filter((u) => u.kind === "payment" && u.daysAway < 0).length;
  const outOfScope = revisions.filter((r) => !r.in_scope).length;
  const sorted = [...projects].sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || b.updated_at.localeCompare(a.updated_at));
  const dateLine = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader
        eyebrow={dateLine}
        title={firstName ? `Hello, ${firstName}` : "Overview"}
        description={projects.length ? `${open.length} open project${open.length === 1 ? "" : "s"}, ${pendingCount} waiting on clients.` : undefined}
        actions={
          <>
            <LinkButton to="/approvals" variant="secondary">
              Approvals
            </LinkButton>
            <LinkButton to="/projects/new">New project</LinkButton>
          </>
        }
      />

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            body="Create a project, list the deliverables and revision rounds, then share a private link so your client can approve it."
            action={<LinkButton to="/projects/new">Create your first project</LinkButton>}
          />
        </Card>
      ) : (
        <>
          <Figures label="Key figures">
            <Figure label="Active projects" tone="accent" value={String(projects.filter((p) => p.status === "active").length)} note={`${open.length} open in total`} />
            <Figure label="Waiting for approval" tone="warning" value={String(pendingCount)} note={pendingCount ? "Scopes and change orders with clients" : "Nothing waiting"} />
            <Figure
              label="Outstanding"
              tone={overduePayments ? "danger" : "neutral"}
              value={outstanding.map(([c, v]) => formatMoney(v, c))}
              note={overduePayments ? `${overduePayments} payment${overduePayments === 1 ? "" : "s"} overdue` : "Still to be paid on live projects"}
              noteTone={overduePayments ? "danger" : undefined}
            />
            <Figure label="Collected" tone="positive" value={collected.map(([c, v]) => formatMoney(v, c))} note="Received on live projects" />
          </Figures>

          {outOfScope ? (
            <div className="mb-6">
              <Alert tone="warning">
                {outOfScope === 1 ? "1 client request is" : `${outOfScope} client requests are`} outside the approved scope.{" "}
                <Link to="/approvals" className="font-semibold underline underline-offset-2">
                  Review in Approvals
                </Link>
              </Alert>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <RemindersCard reminders={reminders} projects={openProjects(q.data)} className="" />

              <Card>
                <CardHeader
                  title="Projects"
                  description="What needs a reply first, then work in progress."
                  action={
                    <Link to="/projects" className="text-[13px] font-medium text-accent hover:underline">
                      All projects
                    </Link>
                  }
                />
                <div className="hidden grid-cols-[minmax(0,1fr)_112px_92px_104px_96px] gap-4 border-b border-line bg-canvas/60 px-5 py-2 text-[12px] font-medium text-muted md:grid">
                  <span>Project</span>
                  <span>Status</span>
                  <span>Deadline</span>
                  <span className="text-right">Value</span>
                  <span>Paid</span>
                </div>
                <ul className="divide-y divide-line" data-testid="dashboard-projects">
                  {sorted.slice(0, 8).map((p) => {
                    const due = currentDueDate(p.due_date, p.extra_days);
                    const contract = contractOf(p);
                    const paid = paidOf(p);
                    const late = due && due < today && p.status === "active";
                    return (
                      <li key={p.id}>
                        <Link
                          to={`/projects/${p.id}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-canvas md:grid-cols-[minmax(0,1fr)_112px_92px_104px_96px]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                            <span className="block truncate text-[13px] text-muted">{p.clients.company || p.clients.name}</span>
                          </span>
                          <span className="justify-self-end md:justify-self-start">
                            <StatusBadge status={p.status} />
                          </span>
                          <span className={cx("num text-[13px]", late ? "font-medium text-danger" : "text-ink-2")}>
                            <span className="text-muted md:hidden">Due </span>
                            {due ? formatDate(due) : "—"}
                          </span>
                          <span className="num justify-self-end text-[13px] font-medium text-ink md:justify-self-end">{formatMoney(contract, p.currency)}</span>
                          <span className="col-span-2 flex items-center gap-2 md:col-span-1">
                            {p.approved_at ? (
                              <>
                                <span className="w-full max-w-[120px] md:max-w-none">
                                  <Meter value={paid} max={contract} tone="positive" />
                                </span>
                                <span className="num w-9 shrink-0 text-right text-[12px] text-muted">{contract ? Math.round((paid / contract) * 100) : 0}%</span>
                              </>
                            ) : (
                              <span className="text-[12px] text-subtle">Not approved yet</span>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {projects.length > 8 ? (
                  <div className="border-t border-line px-5 py-2.5">
                    <Link to="/projects" className="text-[13px] font-medium text-accent hover:underline">
                      See all {projects.length} projects
                    </Link>
                  </div>
                ) : null}
              </Card>
            </div>

            <div className="min-w-0 space-y-6">
              <MoneyIn
                payments={payments}
                currencyOf={(id) => projects.find((p) => p.id === id)?.currency}
                currency={profile.data?.default_currency ?? projects[0]?.currency ?? "INR"}
                today={today}
              />

              <StatusMix counts={projects.reduce((m, p) => m.set(p.status, (m.get(p.status) ?? 0) + 1), new Map<ProjectStatus, number>())} />

              <Card>
                <CardHeader title="Upcoming" description="Overdue, and due in the next 14 days." />
                {upcoming.length === 0 ? (
                  <p className="px-5 py-5 text-[13px] text-muted">Nothing due in the next two weeks.</p>
                ) : (
                  <ul className="divide-y divide-line" data-testid="upcoming">
                    {upcoming.map((u) => (
                      <li key={u.key}>
                        <Link to={`/projects/${u.projectId}`} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-canvas">
                          <DateTile date={u.date} late={u.daysAway < 0} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-ink">{u.kind === "payment" ? u.label : `${u.projectTitle} is due`}</span>
                            <span className="block truncate text-[12px] text-muted">
                              {u.kind === "payment" ? `Payment for ${u.projectTitle}` : "Project deadline"}
                            </span>
                            <span className={cx("block text-[12px] font-medium", u.daysAway < 0 ? "text-danger" : "text-ink-2")}>{whenLabel(u.daysAway)}</span>
                          </span>
                          {u.amountCents !== undefined ? <span className="num shrink-0 text-[13px] font-medium text-ink">{formatMoney(u.amountCents, u.currency)}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader title="Recent activity" />
                {activity.length === 0 ? (
                  <p className="px-5 py-5 text-[13px] text-muted">No activity yet.</p>
                ) : (
                  <ol className="relative space-y-3.5 px-5 py-4 before:absolute before:bottom-5 before:left-[23px] before:top-5 before:w-px before:bg-line">
                    {activity.map((a) => (
                      <li key={a.id} className="relative flex gap-3 text-[13px]">
                        <span className={cx("relative mt-1.5 size-[7px] shrink-0 rounded-full ring-4 ring-surface", a.actor === "client" ? "bg-accent" : "bg-subtle")} aria-hidden />
                        <span className="min-w-0">
                          <Link to={`/projects/${a.project_id}`} className="text-ink hover:underline">
                            {a.summary}
                          </Link>
                          <span className="block truncate text-[12px] text-muted">
                            {a.projects.title}, {formatDateTime(a.created_at)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DateTile({ date, late }: { date: string; late: boolean }) {
  const d = new Date(`${date}T00:00:00Z`);
  return (
    <span className={cx("grid w-10 shrink-0 place-items-center rounded-lg border py-1 text-center leading-none", late ? "border-danger/25 bg-danger-soft text-danger" : "border-line bg-canvas text-ink")} aria-hidden>
      <span className="text-[10px] font-medium">{d.toLocaleDateString("en", { month: "short", timeZone: "UTC" })}</span>
      <span className="num mt-0.5 text-[15px] font-semibold">{d.getUTCDate()}</span>
    </span>
  );
}

/** Money received per month, last 6 months, in one currency (real payments only). */
function MoneyIn({ payments, currencyOf, currency, today }: { payments: { amount_cents: number; paid_on: string; project_id: string }[]; currencyOf: (projectId: string) => string | undefined; currency: string; today: string }) {
  const currencies = [...new Set(payments.map((p) => currencyOf(p.project_id)).filter(Boolean))] as string[];
  const cur = currencies.includes(currency) ? currency : (currencies[0] ?? currency);
  const months = lastMonths(6, today);
  const totals = months.map((m) => payments.filter((p) => currencyOf(p.project_id) === cur && monthOf(p.paid_on) === m).reduce((s, p) => s + Number(p.amount_cents), 0));
  const max = Math.max(...totals, 1);
  const thisMonth = totals[totals.length - 1];
  return (
    <Card>
      <CardHeader
        title="Money in"
        description={currencies.length > 1 ? `Last 6 months, in ${cur}` : "Last 6 months"}
        action={
          <Link to="/analytics" className="text-[13px] font-medium text-accent hover:underline">
            Analytics
          </Link>
        }
      />
      <div className="px-5 py-4">
        <p className="text-[12px] text-muted">This month</p>
        <p className="display num text-[24px] font-semibold leading-tight text-ink">{formatMoney(thisMonth, cur)}</p>
        {payments.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">Payments you record will show here, month by month.</p>
        ) : (
          <div className="mt-4 grid h-[92px] grid-cols-6 items-end gap-2" role="img" aria-label={`Money received per month in ${cur}: ${months.map((m, i) => `${monthLabel(m)} ${formatMoney(totals[i], cur)}`).join(", ")}`}>
            {months.map((m, i) => (
              <div key={m} className="flex h-full flex-col items-center justify-end gap-1.5" title={`${monthLabel(m, "long")}: ${formatMoney(totals[i], cur)}`}>
                <div
                  className={cx("w-full max-w-[28px] rounded-t-[4px]", i === months.length - 1 ? "bg-accent" : "bg-accent/35")}
                  style={{ height: `${totals[i] ? Math.max(4, (totals[i] / max) * 68) : 2}px` }}
                />
                <span className="text-[11px] text-muted">{monthLabel(m)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

const MIX: { status: ProjectStatus; cls: string }[] = [
  { status: "active", cls: "bg-accent" },
  { status: "awaiting_approval", cls: "bg-[#f79009]" },
  { status: "changes_requested", cls: "bg-[#f04438]" },
  { status: "draft", cls: "bg-[#98a2b3]" },
  { status: "completed", cls: "bg-[#17b26a]" },
];

/** How projects are spread across statuses: one bar, real counts. */
function StatusMix({ counts }: { counts: Map<ProjectStatus, number> }) {
  const rows = MIX.filter((m) => counts.get(m.status));
  const total = rows.reduce((s, m) => s + (counts.get(m.status) ?? 0), 0);
  if (!total) return null;
  return (
    <Card>
      <CardHeader title="Projects by status" />
      <div className="px-5 py-4">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={rows.map((m) => `${STATUS_LABEL[m.status]}: ${counts.get(m.status)}`).join(", ")}>
          {rows.map((m) => (
            <span key={m.status} className={m.cls} style={{ width: `${((counts.get(m.status) ?? 0) / total) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
          {rows.map((m) => (
            <Legend key={m.status} swatch={m.cls} label={STATUS_LABEL[m.status]} value={counts.get(m.status) ?? 0} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: ReactNode; value: number }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cx("size-2 shrink-0 rounded-[3px]", swatch)} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>
      <span className="num font-medium text-ink">{value}</span>
    </li>
  );
}
