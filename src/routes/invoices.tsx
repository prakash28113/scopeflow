import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, EmptyState, Figure, Figures, PageHeader, Tag, cx } from "@/components/ui";
import { ActionButton } from "@/components/form-bits";
import { PageSpinner } from "@/components/app-shell";
import { DownloadPdfButton, PrintButton } from "@/components/quote";
import { InvoiceDocument } from "@/components/invoice-document";
import { useToast } from "@/components/toast";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { localToday } from "@/lib/upcoming";
import { invoiceStatus, type InvoiceRow, type InvoiceStatus } from "@/lib/invoice";
import NotFound from "./not-found";

type ListedInvoice = InvoiceRow & { milestones: { status: string; paid_at: string | null; paid_cents?: number } | null; projects: { id: string; title: string } | null };

const SELECT = "*, milestones(status, paid_at, paid_cents), projects(id, title)";

/** The invoice list (shared with prefetching, so opening Invoices is instant). */
export const invoicesQuery = {
  queryKey: ["client-invoices"],
  queryFn: async () => {
    const { data, error } = await supabase.from("client_invoices").select(SELECT).order("created_at", { ascending: false });
    if (error) throw error;
    return data as ListedInvoice[];
  },
};

function useInvoices() {
  return useQuery(invoicesQuery);
}

const statusOf = (i: ListedInvoice, today: string) => invoiceStatus(i, i.milestones?.status === "paid", today, Number(i.milestones?.paid_cents ?? 0));
const balanceOf = (i: ListedInvoice) => (i.milestones?.status === "paid" ? 0 : Math.max(0, Number(i.amount_cents) - Number(i.milestones?.paid_cents ?? 0)));
const TAGS: Record<InvoiceStatus, { tone: "neutral" | "positive" | "warning" | "danger"; label: string }> = {
  due: { tone: "neutral", label: "Due" },
  partial: { tone: "neutral", label: "Part paid" },
  overdue: { tone: "warning", label: "Overdue" },
  paid: { tone: "positive", label: "Paid" },
  void: { tone: "danger", label: "Void" },
};

function sums(rows: ListedInvoice[], amount: (r: ListedInvoice) => number = (r) => Number(r.amount_cents)): string {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + amount(r));
  return [...by].map(([c, v]) => formatMoney(v, c)).join(" · ") || "—";
}

const FILTERS = ["all", "due", "partial", "overdue", "paid", "void"] as const;

/** All invoices across projects, with totals. */
export function InvoicesPage() {
  const q = useInvoices();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  if (q.isLoading) return <PageSpinner />;
  if (q.isError) return <Alert>Couldn't load invoices. Please refresh.</Alert>;
  const today = localToday();
  const rows = q.data ?? [];
  const live = rows.filter((r) => !r.voided_at);
  const month = today.slice(0, 7);
  const shown = filter === "all" ? rows : rows.filter((r) => statusOf(r, today) === filter);

  return (
    <>
      <PageHeader title="Invoices" description="Create an invoice from any payment in a project. Issued invoices are locked; void one to replace it." />
      <Figures label="Invoice totals">
        <Figure label="Invoiced this month" tone="accent" value={sums(live.filter((r) => r.issue_date.startsWith(month)))} />
        <Figure label="Unpaid" tone="warning" value={sums(live.filter((r) => balanceOf(r) > 0), balanceOf)} />
        <Figure label="Overdue" tone="danger" value={sums(live.filter((r) => statusOf(r, today) === "overdue"), balanceOf)} />
        <Figure label="Paid" tone="positive" value={sums(live.filter((r) => statusOf(r, today) === "paid"))} />
      </Figures>
      <Card>
        <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Filter invoices">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cx("rounded-md px-3 py-1.5 text-[13px] capitalize", filter === f ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink")}
            >
              {f}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <EmptyState
            title={rows.length ? "No invoices here" : "No invoices yet"}
            body={rows.length ? "Try another filter." : "Open a project with an approved scope, then tap “Create invoice” next to a payment."}
          />
        ) : (
          <ul className="divide-y divide-line" data-testid="invoice-list">
            {shown.map((r) => {
              const s = statusOf(r, today);
              return (
                <li key={r.id}>
                  {/* Phones: number + status, then client (cut with …) + amount. Wider: one line, as before. */}
                  <Link to={`/invoices/${r.id}`} className="inv-row px-5 py-3.5 hover:bg-sunken/60">
                    <span className="inv-num num whitespace-nowrap text-[13px] font-medium">{r.number}</span>
                    <span className="inv-client min-w-0 truncate text-[13px] text-muted" data-testid="invoice-client">
                      <span className="hidden sm:inline">· </span>
                      {r.buyer.company || r.buyer.name}
                    </span>
                    <span className={cx("inv-amt num whitespace-nowrap text-[13px] font-medium", s === "void" && "text-muted line-through")}>{formatMoney(Number(r.amount_cents), r.currency)}</span>
                    <span className="inv-tag whitespace-nowrap">
                      <Tag tone={TAGS[s].tone}>{TAGS[s].label}</Tag>
                    </span>
                    <span className="inv-meta min-w-0 truncate text-[12px] text-muted">
                      {r.projects?.title ?? r.description} · {formatDate(r.issue_date)}
                      {r.due_date && s !== "paid" && s !== "void" ? ` · due ${formatDate(r.due_date)}` : ""}
                    </span>
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

/** One invoice: printable, with void. */
export function InvoicePage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["invoice", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from("client_invoices").select(SELECT).eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as ListedInvoice | null;
    },
  });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError) return <Alert>Couldn't load this invoice. Please refresh.</Alert>;
  if (!q.data) return <NotFound />;
  const inv = q.data;
  const status = statusOf(inv, localToday());

  async function voidIt() {
    const r = await call(() => supabase.rpc("void_invoice", { p_invoice_id: inv.id, p_reason: null }));
    if (!r.ok) return toast("danger", r.message);
    toast("positive", `Invoice ${inv.number} voided. You can create a new one from the project.`);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["invoice", id] }),
      qc.invalidateQueries({ queryKey: ["client-invoices"] }),
      qc.invalidateQueries({ queryKey: ["project", inv.project_id] }),
    ]);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <Link to="/invoices" className="text-muted hover:text-ink">
            ← Invoices
          </Link>
          {inv.projects ? (
            <Link to={`/projects/${inv.projects.id}`} className="text-muted hover:text-ink">
              {inv.projects.title}
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          {status !== "void" ? (
            <ActionButton
              variant="secondary"
              size="md"
              className="text-danger"
              confirm={`Void invoice ${inv.number}? It stays on record as void (the number is never reused), and you can create a new invoice for this payment.`}
              onAction={voidIt}
            >
              Void invoice
            </ActionButton>
          ) : null}
          <PrintButton label="Print" size="md" />
          <DownloadPdfButton name={`Invoice ${inv.number}`} selector='[data-testid="invoice-document"]' size="md" variant="primary" />
        </div>
      </div>
      {status === "void" ? (
        <Alert tone="info">
          Voided {formatDate(inv.voided_at)}
          {inv.void_reason ? `: ${inv.void_reason}` : ""}. Clients no longer see this invoice.
        </Alert>
      ) : null}
      <InvoiceDocument inv={inv} status={status} paidAt={inv.milestones?.paid_at} paidCents={Number(inv.milestones?.paid_cents ?? 0)} className="mt-3" />
      <p className="mt-3 text-[12px] text-muted print:hidden">
        Your client sees this invoice on their project page. Paid status updates when you mark the payment as received.
      </p>
    </div>
  );
}
