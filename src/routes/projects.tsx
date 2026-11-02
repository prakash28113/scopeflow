import { useState } from "react";
import { Link } from "react-router";
import { Alert, Card, EmptyState, Input, LinkButton, Meter, PageHeader, Segmented, StatusBadge, cx } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useDashboard } from "@/lib/queries";
import { currentDueDate, received } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { localToday } from "@/lib/upcoming";
import type { ProjectStatus } from "@/lib/types";

type Filter = "open" | "active" | "waiting" | "draft" | "completed" | "all";
const FILTERS: Record<Filter, (s: ProjectStatus) => boolean> = {
  open: (s) => s === "draft" || s === "awaiting_approval" || s === "changes_requested" || s === "active",
  active: (s) => s === "active",
  waiting: (s) => s === "awaiting_approval" || s === "changes_requested",
  draft: (s) => s === "draft",
  completed: (s) => s === "completed" || s === "cancelled",
  all: () => true,
};

/** Every project, filterable by status and searchable by project or client. */
export default function ProjectsPage() {
  const q = useDashboard();
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load your projects. Please refresh.</Alert>;
  const today = localToday();
  const all = q.data.projects;
  const count = (f: Filter) => all.filter((p) => FILTERS[f](p.status)).length;
  const term = search.trim().toLowerCase();
  const rows = all
    .filter((p) => FILTERS[filter](p.status))
    .filter((p) => !term || `${p.title} ${p.clients.name} ${p.clients.company ?? ""}`.toLowerCase().includes(term));

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every scope you've written, from draft to paid."
        actions={<LinkButton to="/projects/new">New project</LinkButton>}
      />
      {all.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            body="A project holds the scope your client approves, their requests, change orders, invoices and payments."
            action={<LinkButton to="/projects/new">Create your first project</LinkButton>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Segmented
              label="Filter projects"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "open", label: "Open", count: count("open") },
                { value: "active", label: "In progress", count: count("active") },
                { value: "waiting", label: "With client", count: count("waiting") },
                { value: "draft", label: "Drafts", count: count("draft") },
                { value: "completed", label: "Closed", count: count("completed") },
                { value: "all", label: "All", count: all.length },
              ]}
            />
            <Input type="search" aria-label="Search projects" placeholder="Search projects or clients" value={search} onChange={(e) => setSearch(e.target.value)} className="md:w-72" />
          </div>
          <Card>
            <div className="hidden grid-cols-[minmax(0,1fr)_130px_110px_120px_140px] gap-4 border-b border-line bg-canvas/60 px-5 py-2.5 text-[12px] font-medium text-muted md:grid">
              <span>Project</span>
              <span>Status</span>
              <span>Deadline</span>
              <span className="text-right">Value</span>
              <span>Payments</span>
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No projects match" body={term ? "Try another name, or clear the search." : "Nothing in this view yet."} />
            ) : (
              <ul className="divide-y divide-line" data-testid="projects-list">
                {rows.map((p) => {
                  const due = currentDueDate(p.due_date, p.extra_days);
                  const contract = Number(p.budget_cents) + Number(p.approved_extras_cents);
                  const paid = p.milestones.reduce((s, m) => s + received(m), 0);
                  const late = due && due < today && p.status === "active";
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/projects/${p.id}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-canvas md:grid-cols-[minmax(0,1fr)_130px_110px_120px_140px]"
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
                          {late ? <span className="sr-only"> (late)</span> : null}
                        </span>
                        <span className="num justify-self-end text-[13px] font-medium text-ink">{formatMoney(contract, p.currency)}</span>
                        <span className="col-span-2 md:col-span-1">
                          {p.approved_at ? (
                            <span className="flex items-center gap-2">
                              <span className="w-full max-w-[140px]">
                                <Meter value={paid} max={contract} tone="positive" />
                              </span>
                              <span className="num shrink-0 text-[12px] text-muted">{formatMoney(paid, p.currency)}</span>
                            </span>
                          ) : (
                            <span className="text-[12px] text-subtle">Not approved yet</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}
