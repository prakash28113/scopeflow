import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { intentProps } from "@/lib/prefetch";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, Segmented } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useDashboard } from "@/lib/queries";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { quoteExpired } from "@/lib/quote";
import type { ProjectStatus } from "@/lib/types";

type QuoteState = "draft" | "sent" | "changes" | "approved" | "expired" | "closed";
function stateOf(status: ProjectStatus, validUntil: string | null | undefined): QuoteState {
  if (status === "cancelled") return "closed";
  if (status === "active" || status === "completed") return "approved";
  if (quoteExpired(validUntil)) return "expired";
  if (status === "awaiting_approval") return "sent";
  if (status === "changes_requested") return "changes";
  return "draft";
}
const BADGE: Record<QuoteState, { tone: "neutral" | "accent" | "positive" | "warning" | "danger"; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  sent: { tone: "warning", label: "With client" },
  changes: { tone: "danger", label: "Changes asked" },
  approved: { tone: "positive", label: "Approved" },
  expired: { tone: "danger", label: "Expired" },
  closed: { tone: "neutral", label: "Cancelled" },
};

/**
 * Every project's quote: the scope and price you send for approval. A quote is the project's scope,
 * so it's created and edited with the project; this page lists them and opens the printable quote.
 */
export default function QuotationsPage() {
  const qc = useQueryClient();
  const q = useDashboard();
  const [view, setView] = useState<"open" | "approved" | "all">("open");
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load your quotes. Please refresh.</Alert>;
  const rows = q.data.projects.map((p) => ({ p, state: stateOf(p.status, p.valid_until) }));
  const shown = rows.filter(({ state }) => (view === "open" ? ["draft", "sent", "changes", "expired"].includes(state) : view === "approved" ? state === "approved" : true));
  const openCount = rows.filter(({ state }) => ["draft", "sent", "changes", "expired"].includes(state)).length;

  return (
    <>
      <PageHeader
        title="Quotations"
        description="The scope and price you send each client for approval. Each quote is part of its project."
        actions={<LinkButton to="/projects/new">New quote</LinkButton>}
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No quotes yet"
            body="Start a project, price each deliverable (fixed, hourly or per unit) and send it. Your client approves it from a link."
            action={<LinkButton to="/projects/new">Write your first quote</LinkButton>}
          />
        </Card>
      ) : (
        <>
          <Segmented
            className="mb-4"
            label="Filter quotes"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "Open", count: openCount },
              { value: "approved", label: "Approved", count: rows.filter((r) => r.state === "approved").length },
              { value: "all", label: "All", count: rows.length },
            ]}
          />
          <Card>
            <div className="hidden grid-cols-[minmax(0,1fr)_130px_120px_130px_110px] gap-4 border-b border-line bg-canvas/60 px-5 py-2.5 text-[12px] font-medium text-muted md:grid">
              <span>Quote</span>
              <span>Status</span>
              <span>Valid until</span>
              <span className="text-right">Total</span>
              <span className="sr-only">Actions</span>
            </div>
            {shown.length === 0 ? (
              <EmptyState title="Nothing here" body={view === "open" ? "Every quote has been answered." : "No quotes in this view yet."} />
            ) : (
              <ul className="divide-y divide-line" data-testid="quotations">
                {shown.map(({ p, state }) => (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 md:grid-cols-[minmax(0,1fr)_130px_120px_130px_110px]">
                    <Link to={`/projects/${p.id}`} {...intentProps(qc, `/projects/${p.id}`)} className="min-w-0 hover:underline">
                      <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                      <span className="block truncate text-[13px] text-muted">{p.clients.company || p.clients.name}</span>
                    </Link>
                    <span className="justify-self-end md:justify-self-start">
                      <Badge tone={BADGE[state].tone}>{BADGE[state].label}</Badge>
                    </span>
                    <span className="num text-[13px] text-ink-2">
                      <span className="text-muted md:hidden">Valid until </span>
                      {p.valid_until ? formatDate(p.valid_until) : "No date"}
                    </span>
                    <span className="num justify-self-end text-[13px] font-medium text-ink">{formatMoney(Number(p.budget_cents), p.currency)}</span>
                    <Link to={`/projects/${p.id}/quote`} className="col-span-2 text-[13px] font-medium text-accent hover:underline md:col-span-1 md:justify-self-end">
                      Open quote
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}
