import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useDashboard } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { daysBetween } from "@/lib/reminders";
import { localToday } from "@/lib/upcoming";

/** Client decisions: what's with your clients, what's waiting on you, and what was decided recently. */
export default function ApprovalsPage() {
  const q = useDashboard();
  const decisions = useQuery({
    queryKey: ["approvals", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, event, summary, created_at, project_id, projects(title)")
        .in("event", ["scope.approved", "scope.rejected", "change_order.approved", "change_order.rejected"])
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data as unknown as { id: string; event: string; summary: string; created_at: string; project_id: string; projects: { title: string } }[];
    },
  });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load approvals. Please refresh.</Alert>;
  const today = localToday();
  const { projects, changeOrders, revisions, snapshots } = q.data;
  const lastSent = new Map<string, string>();
  for (const s of snapshots) if (!lastSent.has(s.project_id)) lastSent.set(s.project_id, s.created_at);
  const scopes = projects.filter((p) => p.status === "awaiting_approval");
  const changesAsked = projects.filter((p) => p.status === "changes_requested");
  const outOfScope = revisions.filter((r) => !r.in_scope);
  const withClients = scopes.length + changeOrders.length;
  const onYou = changesAsked.length + outOfScope.length;
  const waited = (iso: string | undefined) => (iso ? daysBetween(iso.slice(0, 10), today) : 0);

  return (
    <>
      <PageHeader title="Approvals" description="Scopes and change orders waiting for a client's decision, and client requests waiting for yours." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={`With your clients · ${withClients}`} description="Sent and waiting for a decision. Reminders nudge you after 3 days." />
          {withClients === 0 ? (
            <EmptyState title="Nothing waiting" body="When you send a scope or a change order, it waits here until your client decides." />
          ) : (
            <ul className="divide-y divide-line" data-testid="approvals-waiting">
              {scopes.map((p) => {
                const days = waited(lastSent.get(p.id));
                return (
                  <li key={p.id}>
                    <Link to={`/projects/${p.id}`} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-canvas">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink">Scope for {p.title}</span>
                        <span className="block text-[13px] text-muted">
                          {p.clients.company || p.clients.name}, sent {lastSent.get(p.id) ? formatDate(lastSent.get(p.id)!) : "recently"}
                        </span>
                      </span>
                      <Badge tone={days >= 3 ? "warning" : "neutral"}>{days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</Badge>
                    </Link>
                  </li>
                );
              })}
              {changeOrders.map((c) => {
                const days = waited(c.created_at);
                return (
                  <li key={c.id}>
                    <Link to={`/projects/${c.project_id}`} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-canvas">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink">
                          Change order #{c.number}: {c.title}
                        </span>
                        <span className="num block text-[13px] text-muted">
                          {c.projects.title}, {formatMoney(Number(c.amount_cents), c.projects.currency)}
                        </span>
                      </span>
                      <Badge tone={days >= 3 ? "warning" : "neutral"}>{days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={`Waiting on you · ${onYou}`} description="Clients asked for changes, or asked for work outside the agreed scope." />
          {onYou === 0 ? (
            <EmptyState title="All answered" body="Client requests that need a decision from you appear here." />
          ) : (
            <ul className="divide-y divide-line" data-testid="approvals-on-you">
              {changesAsked.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-canvas">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                      <span className="block text-[13px] text-muted">Your client asked for changes to the scope. Edit it and send it again.</span>
                    </span>
                    <Badge tone="danger">Changes asked</Badge>
                  </Link>
                </li>
              ))}
              {outOfScope.map((r) => (
                <li key={r.id}>
                  <Link to={`/projects/${r.project_id}#requests`} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-canvas">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink">{r.projects.title}</span>
                      <span className="line-clamp-2 block text-[13px] text-muted">“{r.description}”</span>
                    </span>
                    <Badge tone="warning">Out of scope</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent decisions" description="What your clients approved or sent back, newest first." />
        {decisions.isLoading ? (
          <p className="px-5 py-5 text-[13px] text-muted">Loading…</p>
        ) : !decisions.data?.length ? (
          <EmptyState title="No decisions yet" body="Approvals and change requests from your clients will be listed here, with the date." />
        ) : (
          <ul className="divide-y divide-line">
            {decisions.data.map((d) => {
              const approved = d.event.endsWith("approved");
              return (
                <li key={d.id}>
                  <Link to={`/projects/${d.project_id}`} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-canvas">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] text-ink">{d.summary}</span>
                      <span className="block text-[12px] text-muted">
                        {d.projects.title}, {formatDateTime(d.created_at)}
                      </span>
                    </span>
                    <Badge tone={approved ? "positive" : "danger"}>{approved ? "Approved" : "Sent back"}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
