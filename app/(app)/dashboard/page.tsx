import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, StatusBadge, Tag } from "@/components/ui";
import { Flash } from "@/components/flash";
import { readFlash } from "@/lib/flash";
import { requireUser } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { currentDueDate } from "@/lib/pricing";
import type { Project, ProjectStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

type Row = Project & {
  clients: { name: string; company: string | null };
  milestones: { amount_cents: number; status: string }[];
};

const OPEN: ProjectStatus[] = ["draft", "awaiting_approval", "changes_requested", "active"];

function sumByCurrency(items: { currency: string; amount: number }[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.currency, (m.get(i.currency) ?? 0) + i.amount);
  return [...m.entries()].filter(([, v]) => v !== 0);
}

export default async function DashboardPage() {
  const { supabase, profile } = await requireUser();
  const [projectsRes, cosRes, revRes, activityRes, flash] = await Promise.all([
    supabase
      .from("projects")
      .select("*, clients(name, company), milestones(amount_cents, status)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("change_orders")
      .select("id, number, title, amount_cents, created_at, project_id, projects(title, currency)")
      .eq("status", "sent")
      .order("created_at", { ascending: false }),
    supabase
      .from("revision_requests")
      .select("id, kind, in_scope, description, created_at, project_id, projects(title)")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("activity_log")
      .select("id, summary, actor, created_at, project_id, projects(title)")
      .order("created_at", { ascending: false })
      .limit(8),
    readFlash(),
  ]);

  const projects = (projectsRes.data ?? []) as Row[];
  const changeOrders = (cosRes.data ?? []) as unknown as {
    id: string; number: number; title: string; amount_cents: number; created_at: string; project_id: string;
    projects: { title: string; currency: string };
  }[];
  const revisions = (revRes.data ?? []) as unknown as {
    id: string; kind: string; in_scope: boolean; description: string; created_at: string; project_id: string;
    projects: { title: string };
  }[];
  const activity = (activityRes.data ?? []) as unknown as {
    id: string; summary: string; actor: string; created_at: string; project_id: string; projects: { title: string };
  }[];

  const open = projects.filter((p) => OPEN.includes(p.status));
  const awaitingScope = projects.filter((p) => p.status === "awaiting_approval");
  const needsYou = projects.filter((p) => p.status === "changes_requested");
  const live = projects.filter((p) => p.status === "active" || p.status === "completed");

  const outstanding = sumByCurrency(
    live.map((p) => ({
      currency: p.currency,
      amount:
        Number(p.budget_cents) +
        Number(p.approved_extras_cents) -
        p.milestones.filter((m) => m.status === "paid").reduce((s, m) => s + Number(m.amount_cents), 0),
    })),
  );
  const collected = sumByCurrency(
    live.map((p) => ({
      currency: p.currency,
      amount: p.milestones.filter((m) => m.status === "paid").reduce((s, m) => s + Number(m.amount_cents), 0),
    })),
  );

  const firstName = (profile.full_name ?? "").split(" ")[0];
  const pendingCount = awaitingScope.length + changeOrders.length;

  return (
    <>
      <Flash flash={flash} />
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Dashboard"}
        description={
          projects.length
            ? `${open.length} open project${open.length === 1 ? "" : "s"} · ${pendingCount} waiting on clients`
            : undefined
        }
      />

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            body="Create a project, define the deliverables and revision limits, then send your client a link to approve it."
            action={<LinkButton href="/projects/new">Create your first project</LinkButton>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-4">
            <Stat label="In progress" value={String(projects.filter((p) => p.status === "active").length)} />
            <Stat label="Waiting on clients" value={String(pendingCount)} />
            <Stat label="Outstanding" value={outstanding.map(([c, v]) => formatMoney(v, c)).join(" · ") || "—"} />
            <Stat label="Collected" value={collected.map(([c, v]) => formatMoney(v, c)).join(" · ") || "—"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              <Card>
                <CardHeader title="Projects" />
                <ul className="divide-y divide-line">
                  {projects.map((p) => {
                    const due = currentDueDate(p.due_date, p.extra_days);
                    return (
                      <li key={p.id}>
                        <Link href={`/projects/${p.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-sunken/60">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{p.title}</p>
                            <p className="mt-0.5 truncate text-[13px] text-muted">
                              {p.clients.company || p.clients.name}
                              {due ? ` · due ${formatDate(due)}` : ""}
                            </p>
                          </div>
                          <span className="num hidden text-[13px] text-ink-2 sm:block">
                            {formatMoney(Number(p.budget_cents) + Number(p.approved_extras_cents), p.currency)}
                          </span>
                          <StatusBadge status={p.status} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Pending approvals" description="Waiting for a client decision." />
                {awaitingScope.length + changeOrders.length === 0 ? (
                  <p className="px-5 py-6 text-[13px] text-muted">Nothing pending.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {awaitingScope.map((p) => (
                      <li key={p.id}>
                        <Link href={`/projects/${p.id}`} className="block px-5 py-3 hover:bg-sunken/60">
                          <p className="text-[13px] font-medium">Scope · {p.title}</p>
                          <p className="text-[12px] text-muted">Sent {formatDate(p.updated_at)}</p>
                        </Link>
                      </li>
                    ))}
                    {changeOrders.map((c) => (
                      <li key={c.id}>
                        <Link href={`/projects/${c.project_id}`} className="block px-5 py-3 hover:bg-sunken/60">
                          <p className="text-[13px] font-medium">
                            Change order #{c.number} · {c.projects.title}
                          </p>
                          <p className="num text-[12px] text-muted">
                            {formatMoney(Number(c.amount_cents), c.projects.currency)} · sent {formatDate(c.created_at)}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {needsYou.length + revisions.length > 0 ? (
                <Card>
                  <CardHeader title="Needs your attention" />
                  <ul className="divide-y divide-line">
                    {needsYou.map((p) => (
                      <li key={p.id}>
                        <Link href={`/projects/${p.id}`} className="block px-5 py-3 hover:bg-sunken/60">
                          <p className="text-[13px] font-medium">{p.title}</p>
                          <p className="text-[12px] text-danger">Client asked for scope changes</p>
                        </Link>
                      </li>
                    ))}
                    {revisions.map((r) => (
                      <li key={r.id}>
                        <Link href={`/projects/${r.project_id}#requests`} className="block px-5 py-3 hover:bg-sunken/60">
                          <div className="flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.projects.title}</p>
                            {r.in_scope ? <Tag tone="accent">In scope</Tag> : <Tag tone="warning">Out of scope</Tag>}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{r.description}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <Card>
                <CardHeader title="Recent activity" />
                {activity.length === 0 ? (
                  <p className="px-5 py-6 text-[13px] text-muted">No activity yet.</p>
                ) : (
                  <ul className="space-y-3 px-5 py-4">
                    {activity.map((a) => (
                      <li key={a.id} className="text-[13px]">
                        <Link href={`/projects/${a.project_id}`} className="hover:underline">
                          {a.summary}
                        </Link>
                        <p className="text-[12px] text-muted">
                          {a.projects.title} · {formatDateTime(a.created_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <p className="num mt-1 truncate text-xl font-semibold tracking-[-0.02em]" title={value}>
        {value}
      </p>
    </div>
  );
}
