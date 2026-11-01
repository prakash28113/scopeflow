import { useEffect, useState } from "react";
import { Alert, Card, Logo, Meter, Tag } from "@/components/ui";
import { AgreementTerms, RevisionMeter } from "@/components/agreement";
import { PrintButton, QuoteTable } from "@/components/quote";
import { UpiPay } from "@/components/upi-pay";
import { InvoiceDocument } from "@/components/invoice-document";
import { invoiceStatus } from "@/lib/invoice";
import { localToday } from "@/lib/upcoming";
import { progressLabel, progressSummary } from "@/lib/progress";
import { PageSpinner } from "@/components/app-shell";
import { usePortal } from "@/lib/queries";
import { tokenFromHash } from "@/lib/portal-link";
import type { PortalError } from "@/lib/portal-rpc";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, pluralize, shortHash, STATUS_LABEL } from "@/lib/format";
import { currentDueDate } from "@/lib/pricing";
import type { ScopeData } from "@/lib/types";
import { ChangeOrderDecisionForm, RevisionRequestForm, ScopeDecisionForm } from "./portal-forms";

function useHashToken() {
  const [token, setToken] = useState(() => tokenFromHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setToken(tokenFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return token;
}

export default function PortalPage() {
  const token = useHashToken();
  const q = usePortal(token);

  useEffect(() => {
    document.title = q.data ? `${q.data.project.title} · ScopeFlow` : "Project · ScopeFlow";
    // Keep client pages out of search engines even if a link leaks.
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = "noindex, nofollow";
  }, [q.data]);

  if (token && q.isLoading) return <PageSpinner />;
  const v = q.data;
  if (!token || !v) {
    const err = q.error as PortalError | null;
    const expired = err?.kind === "expired_link";
    const limited = err?.kind === "rate_limited";
    const offline = Boolean(err) && !err?.kind;
    return (
      <Shell>
        <div className="py-16 text-center">
          <h1 className="text-xl font-semibold">
            {expired ? "This link has expired" : limited ? "Too many requests" : offline ? "Couldn't load the project" : "This link isn't working"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            {expired
              ? "Ask your freelancer to send you a new link."
              : limited
                ? "Please wait a few minutes, then reload the page."
                : offline
                ? "Check your connection and reload the page."
                : "It may have been replaced or revoked, or copied incompletely. Ask your freelancer for the current project link."}
          </p>
        </div>
      </Shell>
    );
  }

  const { project: p, snapshot } = v;
  const fmt = (n: number) => formatMoney(Number(n), p.currency);
  const pendingCos = v.change_orders.filter((c) => c.status === "sent");
  const decidedCos = v.change_orders.filter((c) => c.status !== "sent");
  const paid = v.milestones.filter((m) => m.status === "paid").reduce((s, m) => s + Number(m.amount_cents), 0);
  const contract = Number(p.budget_cents) + Number(p.approved_extras_cents);
  const due = currentDueDate(p.due_date, p.extra_days);

  return (
    <Shell from={v.freelancer.name}>
      <header className="mb-8">
        <p className="text-[13px] text-muted">
          {v.freelancer.name} · for {v.client.company || v.client.name}
        </p>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-balance">{p.title}</h1>
        <p className="mt-2 text-[13px] text-ink-2">{STATUS_LABEL[p.status]}</p>
      </header>

      {/* ---------------------------------------------- scope approval */}
      {p.status === "awaiting_approval" && snapshot ? (
        <>
          <Alert tone="info">
            {snapshot.version > 1 ? `This is version ${snapshot.version}, updated after your feedback. ` : ""}
            Please review the scope below, then approve it or ask for changes.
          </Alert>
          <ScopeDocument data={snapshot.data} hash={snapshot.content_hash} version={snapshot.version} sentAt={snapshot.created_at} />
          <Card className="mt-6 p-5 sm:p-6">
            <h2 className="mb-4 text-[15px] font-semibold">Your decision</h2>
            <ScopeDecisionForm token={token} snapshotId={snapshot.id} clientName={v.client.name} />
          </Card>
        </>
      ) : null}

      {(p.status === "draft" || p.status === "changes_requested") && !p.approved_at ? (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium">{snapshot ? "The scope is being updated" : "The scope is being prepared"}</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
            {snapshot?.decision?.decision === "rejected"
              ? `Thanks for your feedback on ${formatDate(snapshot.decision.created_at)}. The revised version will appear on this page; your freelancer will let you know.`
              : `${v.freelancer.name} will share it here for your approval.`}
          </p>
        </Card>
      ) : null}

      {/* ---------------------------------------------- active project */}
      {p.approved_at ? (
        <div className="space-y-6">
          {pendingCos.map((c) => (
            <Card key={c.id} className="border-accent-line">
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <Tag tone="warning">Needs your approval</Tag>
                <h2 className="mt-2 text-[17px] font-semibold tracking-[-0.01em]">
                  Change order #{c.number}: {c.title}
                </h2>
                {c.description ? <p className="mt-1.5 whitespace-pre-line text-sm text-ink-2">{c.description}</p> : null}
              </div>
              <dl className="num grid grid-cols-2 gap-4 border-b border-line px-5 py-4 text-[13px] sm:grid-cols-3 sm:px-6">
                <div>
                  <dt className="text-muted">Additional cost</dt>
                  <dd className="mt-0.5 text-base font-semibold">{fmt(c.amount_cents)}</dd>
                  {c.pricing_type === "hourly" && c.hourly_rate_cents !== null ? (
                    <dd className="text-[12px] text-muted">
                      {Number(c.hours)} h × {fmt(c.hourly_rate_cents)}
                    </dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-muted">Additional time</dt>
                  <dd className="mt-0.5 text-base font-semibold">{c.additional_days ? `+${pluralize(c.additional_days, "day")}` : "None"}</dd>
                </div>
                <div>
                  <dt className="text-muted">New total</dt>
                  <dd className="mt-0.5 text-base font-semibold">{fmt(contract + Number(c.amount_cents))}</dd>
                </div>
              </dl>
              <div className="px-5 py-4 sm:px-6">
                <ChangeOrderDecisionForm token={token} changeOrderId={c.id} clientName={v.client.name} />
              </div>
            </Card>
          ))}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-3">
            <Summary label="Project total" value={fmt(contract)} sub={Number(p.approved_extras_cents) ? `incl. ${fmt(p.approved_extras_cents)} in changes` : undefined} />
            <Summary label="Paid" value={fmt(paid)} sub={`${fmt(contract - paid)} remaining`} />
            <Summary label="Due" value={formatDate(due)} sub={p.extra_days ? `+${pluralize(p.extra_days, "day")} from changes` : undefined} />
          </div>

          {p.status === "active" ? (
            <Card>
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <h2 className="text-[15px] font-semibold">Request a change</h2>
                <p className="mt-0.5 text-[13px] text-muted">Requests are checked against what you approved.</p>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <RevisionRequestForm
                  token={token}
                  clientName={v.client.name}
                  deliverables={v.deliverables}
                  extraRevisionCents={snapshot?.data.extra_revision_cents ?? null}
                  currency={v.project.currency}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="border-b border-line px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold">Deliverables</h2>
                <span className="num text-[12px] text-muted" data-testid="portal-progress">
                  {progressSummary(v.deliverables).label}
                </span>
              </div>
              <div className="mt-2">
                <Meter value={progressSummary(v.deliverables).pct} max={100} tone="positive" />
              </div>
            </div>
            <ul className="divide-y divide-line">
              {v.deliverables.map((d) => (
                <li key={d.id} className="px-5 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{d.title}</p>
                      {d.description ? <p className="mt-0.5 whitespace-pre-line text-[13px] text-muted">{d.description}</p> : null}
                    </div>
                    <Tag tone={d.progress === "delivered" ? "positive" : d.progress === "in_progress" ? "accent" : "neutral"}>{progressLabel(d.progress)}</Tag>
                  </div>
                  <RevisionMeter used={d.revisions_used + (d.revisions_extra ?? 0)} included={d.revisions_included} />
                </li>
              ))}
            </ul>
          </Card>

          {v.revision_requests.length ? (
            <Card>
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <h2 className="text-[15px] font-semibold">Your requests</h2>
              </div>
              <ul className="divide-y divide-line">
                {v.revision_requests.map((r) => (
                  <li key={r.id} className="px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-medium">{r.kind === "revision" ? r.deliverable_title : "New work"}</p>
                      {r.in_scope ? <Tag tone="accent">Included</Tag> : <Tag tone="warning">Beyond scope</Tag>}
                      <Tag tone={r.status === "resolved" ? "positive" : "neutral"}>
                        {r.status === "open" ? "Received" : r.status === "resolved" ? "Done" : "Quoted"}
                      </Tag>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{r.description}</p>
                    {r.resolution_note ? <p className="mt-1 text-[12px] text-muted">Reply: {r.resolution_note}</p> : null}
                    <p className="mt-1 text-[12px] text-muted">{formatDateTime(r.created_at)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {v.milestones.length ? (
            <Card>
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <h2 className="text-[15px] font-semibold">Payment schedule</h2>
              </div>
              <ul className="divide-y divide-line">
                {v.milestones.map((m, i) => (
                  <li key={i} className="px-5 py-3.5 sm:px-6">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{m.title}</p>
                        <p className="text-[12px] text-muted">
                          {m.status === "paid" ? `Received ${formatDate(m.paid_at)}` : m.due_date ? `Due ${formatDate(m.due_date)}` : "Upcoming"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="num text-[13px] font-medium">{fmt(m.amount_cents)}</span>
                        {m.status === "paid" ? <Tag tone="positive">Paid</Tag> : null}
                      </div>
                    </div>
                    {m.status !== "paid" && v.payment ? (
                      <UpiPay upiId={v.payment.upi_id} payee={v.payment.payee_name || v.freelancer.name} amountPaise={Number(m.amount_cents)} note={m.invoice_number || `${p.title} ${m.title}`} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {v.invoices?.length ? <PortalInvoices invoices={v.invoices} /> : null}

          {decidedCos.length ? (
            <Card>
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <h2 className="text-[15px] font-semibold">Change orders</h2>
              </div>
              <ul className="divide-y divide-line">
                {decidedCos.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-3.5 sm:px-6">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">
                        #{c.number} · {c.title}
                      </p>
                      <p className="text-[12px] text-muted">
                        {c.status === "approved" ? "Approved" : "Declined"}
                        {c.decision ? ` by ${c.decision.client_name} · ${formatDateTime(c.decision.created_at)}` : ""}
                      </p>
                    </div>
                    <span className="num text-[13px]">{fmt(c.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {snapshot ? (
            <details className="group rounded-[var(--radius-card)] border border-line bg-surface">
              <summary className="cursor-pointer list-none px-5 py-4 text-[13px] font-medium sm:px-6">
                View the approved scope (v{snapshot.version})
                {snapshot.decision ? (
                  <span className="font-normal text-muted">
                    {" "}
                    · approved by {snapshot.decision.client_name}, {formatDate(snapshot.decision.created_at)}
                  </span>
                ) : null}
              </summary>
              <div className="border-t border-line px-1 pb-1">
                <ScopeDocument data={snapshot.data} hash={snapshot.content_hash} version={snapshot.version} sentAt={snapshot.created_at} flat />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({ children, from }: { children: React.ReactNode; from?: string }) {
  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-8 sm:pt-14">
        {children}
        <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[12px] text-muted">
          <span>{from ? `Shared privately by ${from}. Please don't forward this link.` : ""}</span>
          <span className="inline-flex items-center gap-1.5">
            Powered by <Logo className="text-[11px]" />
          </span>
        </footer>
      </div>
    </div>
  );
}

function Summary({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface px-4 py-3.5 sm:px-5 last:col-span-2 sm:last:col-span-1">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="num mt-0.5 text-[17px] font-semibold tracking-[-0.01em]">{value}</p>
      {sub ? <p className="num text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}

function ScopeDocument({
  data,
  hash,
  version,
  sentAt,
  flat,
}: {
  data: ScopeData;
  hash: string;
  version: number;
  sentAt: string;
  flat?: boolean;
}) {
  const fmt = (n: number) => formatMoney(Number(n), data.currency);
  return (
    <article data-print-scope className={flat ? "" : "mt-6 rounded-[var(--radius-card)] border border-line bg-surface"}>
      {data.summary ? <p className="whitespace-pre-line border-b border-line px-5 py-5 text-sm leading-relaxed text-ink-2 sm:px-6">{data.summary}</p> : null}

      <section className="border-b border-line px-5 py-5 sm:px-6">
        <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Deliverables</h3>
        <ol className="space-y-4">
          {data.deliverables.map((d, i) => (
            <li key={d.id} className="flex gap-3">
              <span className="num mt-px text-[13px] text-subtle">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium">{d.title}</p>
                  <p className="text-[12px] text-muted">{pluralize(d.revisions_included, "revision")} included</p>
                </div>
                {d.description ? <p className="mt-0.5 whitespace-pre-line text-[13px] text-muted">{d.description}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {data.pricing ? (
        <section className="border-b border-line px-5 py-5 sm:px-6">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Quote</h3>
          <QuoteTable lines={data.deliverables} pricing={data.pricing} currency={data.currency} />
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-4 border-b border-line px-5 py-5 text-[13px] sm:grid-cols-3 sm:px-6">
        <div>
          <p className="text-muted">Budget</p>
          <p className="num mt-0.5 text-base font-semibold">{fmt(data.budget_cents)}</p>
        </div>
        <div>
          <p className="text-muted">Start</p>
          <p className="mt-0.5 text-base font-semibold">{formatDate(data.start_date)}</p>
        </div>
        <div>
          <p className="text-muted">Due</p>
          <p className="mt-0.5 text-base font-semibold">{formatDate(data.due_date)}</p>
        </div>
      </section>

      <AgreementTerms
        exclusions={data.exclusions}
        terms={data.terms}
        extraRevisionCents={data.extra_revision_cents}
        currency={data.currency}
        className="border-b border-t-0 [&>section]:sm:px-6"
      />

      {data.milestones.length ? (
        <section className="border-b border-line px-5 py-5 sm:px-6">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Payment schedule</h3>
          <ul className="space-y-2">
            {data.milestones.map((m, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span>
                  {m.title}
                  {m.due_date ? <span className="text-muted"> · {formatDate(m.due_date)}</span> : null}
                </span>
                <span className="num font-medium">{fmt(m.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
        <p className="text-[11px] text-muted">
          Version {version} · sent {formatDateTime(sentAt)} · fingerprint <span className="font-mono">{shortHash(hash)}</span>
        </p>
        <PrintButton />
      </div>
    </article>
  );
}

/** Invoices the freelancer issued: open one to read, print or save as PDF. */
function PortalInvoices({ invoices }: { invoices: NonNullable<import("@/lib/types").PortalView["invoices"]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const today = localToday();
  const shown = invoices.find((i) => i.id === open);
  return (
    <Card>
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="text-[15px] font-semibold">Invoices</h2>
      </div>
      <ul className="divide-y divide-line" data-testid="portal-invoices">
        {invoices.map((inv) => {
          const s = invoiceStatus(inv, inv.paid, today);
          return (
            <li key={inv.id} className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
              <div className="min-w-0">
                <p className="num text-[13px] font-medium">{inv.number}</p>
                <p className="text-[12px] text-muted">
                  {formatDate(inv.issue_date)}
                  {s === "paid" ? " · Paid" : inv.due_date ? ` · Due ${formatDate(inv.due_date)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num text-[13px] font-medium">{formatMoney(Number(inv.amount_cents), inv.currency)}</span>
                {s === "overdue" ? <Tag tone="warning">Overdue</Tag> : s === "paid" ? <Tag tone="positive">Paid</Tag> : null}
                <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setOpen(open === inv.id ? null : inv.id)}>
                  {open === inv.id ? "Close" : "View"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {shown ? (
        <div className="border-t border-line p-3 sm:p-5">
          <div className="mb-3 flex justify-end print:hidden">
            <PrintButton label="Print or save as PDF" />
          </div>
          <InvoiceDocument inv={shown} status={invoiceStatus(shown, shown.paid, today)} paidAt={shown.paid_at} className="border-0 p-0 sm:p-2" />
        </div>
      ) : null}
    </Card>
  );
}
