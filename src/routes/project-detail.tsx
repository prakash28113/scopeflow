import { quoteExpired } from "@/lib/quote";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  LinkButton,
  Meter,
  PageHeader,
  Select,
  StatusBadge,
  Tag,
  buttonClass,
} from "@/components/ui";
import { ActionButton } from "@/components/form-bits";
import { PageSpinner } from "@/components/app-shell";
import { ShareLinkDialog } from "@/components/share-link-dialog";
import { AgreementTerms, RevisionMeter } from "@/components/agreement";
import { QuoteTable, pricingFrom } from "@/components/quote";
import { useToast } from "@/components/toast";
import { CreateInvoice } from "@/components/create-invoice";
import { localToday } from "@/lib/upcoming";
import { RecordPayment } from "@/components/record-payment";
import { AddFollowUp } from "@/components/reminders";
import { LogRequest, sourceLabel } from "@/components/log-request";
import { methodLabel } from "@/lib/payments";
import { PROGRESS, progressSummary, type Progress } from "@/lib/progress";
import { useProfile } from "@/lib/auth";
import { useProject, type FullProject } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { LINK_VALIDITY_DAYS, portalUrl } from "@/lib/portal-link";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, pluralize, shortHash } from "@/lib/format";
import { currentDueDate, projectTotals, received } from "@/lib/pricing";
import type { ChangeOrder, RevisionRequest, ScopeDecision, ScopeSnapshot, ShareLinkStatus } from "@/lib/types";
import NotFound from "./not-found";

type NewLink = { url: string; expiresAt: string } | null;

export default function ProjectPage() {
  const { id } = useParams();
  const q = useProject(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [newLink, setNewLink] = useState<NewLink>(null);
  const [linkDays, setLinkDays] = useState<number>(30);
  const profile = useProfile();

  if (q.isLoading) return <PageSpinner />;
  if (q.isError) return <Alert>Couldn't load this project. Please refresh.</Alert>;
  if (!q.data) return <NotFound />;

  const { project: p, snapshots, decisions, revisions, changeOrders, activity, link, invoices, payments, followUps, expenses } = q.data;
  const liveInvoice = (milestoneId: string) => invoices.find((i) => i.milestone_id === milestoneId && !i.voided_at);
  const pid = p.id;
  const latest = snapshots[0];
  const latestDecision = latest ? decisions.find((d) => d.snapshot_id === latest.id) : undefined;
  const editable = p.status === "draft" || p.status === "changes_requested";
  const approved = Boolean(p.approved_at);
  const money = projectTotals(Number(p.budget_cents), Number(p.approved_extras_cents), p.milestones);
  /** Expenses you linked to this project (in its currency) and profit so far. */
  const spent = expenses.filter((e) => e.currency === p.currency).reduce((s, e) => s + Number(e.amount_cents), 0);
  const due = currentDueDate(p.due_date, p.extra_days);
  /** In-scope rounds plus rounds requested beyond the limit. */
  const requested = (dId: string) => revisions.filter((r) => r.deliverable_id === dId && r.kind === "revision").length;
  const fmt = (n: number) => formatMoney(n, p.currency);
  const pricing = pricingFrom(p.deliverables, p.discount_bps, p.tax_bps, p.tax_label);

  /** Runs a database function, reports the result and refreshes the page data. */
  async function act<T>(fn: () => PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>, success?: string) {
    const r = await call(fn);
    if (!r.ok) toast("danger", r.message);
    else if (success) toast("positive", success);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["project", pid] }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
    return r;
  }
  const showLink = (l: { token: string; expires_at: string }) =>
    setNewLink({ url: portalUrl(window.location.origin, l.token), expiresAt: l.expires_at });

  async function sendScope() {
    const r = await act(() => supabase.rpc("send_scope", { p_project_id: pid, p_link_days: linkDays }));
    if (!r.ok) return;
    const res = r.data as { version: number; link: { token: string; expires_at: string } | null };
    if (res.link) {
      showLink(res.link);
      toast("positive", `Scope v${res.version} is ready for approval. Share the link with ${p.clients.name}.`);
    } else {
      toast("positive", `Scope v${res.version} sent. ${p.clients.name}'s existing link now shows the new version.`);
    }
  }

  async function rotate() {
    const r = await act(() => supabase.rpc("rotate_share_link", { p_project_id: pid, p_expires_in_days: linkDays }));
    if (r.ok) showLink(r.data as { token: string; expires_at: string });
  }

  return (
    <>
      <ShareLinkDialog link={newLink} clientName={p.clients.name} clientEmail={p.clients.email} projectTitle={p.title} onClose={() => setNewLink(null)} />
      <PageHeader
        eyebrow={
          <Link to="/dashboard" className="hover:text-ink">
            ← Dashboard
          </Link>
        }
        title={p.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            <span className="break-all">
              {p.clients.name}
              {p.clients.company ? ` · ${p.clients.company}` : ""} · {p.clients.email}
            </span>
          </span>
        }
        actions={
          <>
            {editable ? (
              <LinkButton to={`/projects/${pid}/edit`} variant="secondary">
                Edit scope
              </LinkButton>
            ) : null}
            {editable ? (
              <ActionButton onAction={sendScope} pendingLabel="Sending…">
                {p.status === "changes_requested" ? "Send revised scope" : "Send to client"}
              </ActionButton>
            ) : null}
            {snapshots.length ? (
              <LinkButton variant="secondary" to={`/projects/${pid}/record`}>
                Approval record
              </LinkButton>
            ) : null}
            {p.status === "active" ? <LinkButton to={`/projects/${pid}/change-orders/new`}>New change order</LinkButton> : null}
          </>
        }
      />

      <NextStep p={p} latest={latest} decision={latestDecision} revisions={revisions} changeOrders={changeOrders} />

      <JumpLinks
        links={[
          { href: "#scope", label: "Scope" },
          ...(approved ? [{ href: "#requests", label: "Requests" }] : []),
          { href: "#payments", label: "Payments" },
          { href: "#history", label: "Timeline" },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {/* -------------------------------------------- scope */}
          <Card>
            <div id="scope" className="scroll-mt-24" />
            <CardHeader
              title="Scope"
              description={
                approved
                  ? `Approved ${formatDate(p.approved_at)} — changes go through change orders.`
                  : `${editable ? "Draft — editable until your client approves it." : "Locked while your client reviews it."}${
                      p.valid_until ? ` Quote valid until ${formatDate(p.valid_until)}${quoteExpired(p.valid_until) ? " (expired: edit the scope to set a new date)" : ""}.` : ""
                    }`
              }
            />
            {p.summary ? <p className="whitespace-pre-line border-b border-line px-5 py-4 text-sm text-ink-2">{p.summary}</p> : null}
            {approved && p.deliverables.length ? (
              <div className="border-b border-line px-5 py-3" data-testid="project-progress">
                <div className="mb-1.5 flex items-center justify-between text-[13px]">
                  <span className="font-medium">Progress</span>
                  <span className="num text-muted">
                    {progressSummary(p.deliverables).label} · {progressSummary(p.deliverables).pct}%
                  </span>
                </div>
                <Meter value={progressSummary(p.deliverables).pct} max={100} tone="positive" />
              </div>
            ) : null}
            <ul className="divide-y divide-line">
              {p.deliverables.map((d) => {
                return (
                  <li key={d.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{d.title}</p>
                        {d.description ? <p className="mt-0.5 whitespace-pre-line text-[13px] text-muted">{d.description}</p> : null}
                        {d.due_date ? <DeliverableDue due={currentDueDate(d.due_date, p.extra_days)!} delivered={d.progress === "delivered"} extended={p.extra_days > 0} /> : null}
                      </div>
                      <p className="num shrink-0 text-[13px] text-ink-2">
                        {approved ? null : pluralize(d.revisions_included, "revision")}
                      </p>
                    </div>
                    {approved ? <RevisionMeter used={requested(d.id)} included={d.revisions_included} /> : null}
                    {approved ? (
                      <ProgressControl
                        title={d.title}
                        value={d.progress ?? "not_started"}
                        disabled={p.status === "completed" || p.status === "cancelled"}
                        onChange={(next) =>
                          act(() => supabase.rpc("set_deliverable_progress", { p_deliverable_id: d.id, p_progress: next }), `${d.title}: ${PROGRESS.find((x) => x.value === next)!.label.toLowerCase()}.`)
                        }
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {pricing ? (
              <div className="border-t border-line px-5 py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-[13px] font-semibold">Quote</h3>
                  <Link to={`/projects/${pid}/quote`} className="text-[13px] font-medium text-accent hover:underline">
                    Printable quote
                  </Link>
                </div>
                <QuoteTable lines={p.deliverables} pricing={pricing} currency={p.currency} />
              </div>
            ) : null}
            <AgreementTerms exclusions={p.exclusions} terms={p.terms} extraRevisionCents={p.extra_revision_cents} currency={p.currency} />
          </Card>

          {/* -------------------------------------------- requests */}
          {approved ? (
            <Card>
              <div id="requests" className="scroll-mt-24" />
              <CardHeader title="Revision & change requests" description="Each request is checked against the approved scope, whether the client used their link or you logged it." />
              {p.status === "active" ? (
                <div className="border-b border-line px-5 py-3">
                  <LogRequest
                    projectId={pid}
                    deliverables={p.deliverables.map((d) => ({ id: d.id, title: d.title }))}
                    minDate={p.approved_at ? p.approved_at.slice(0, 10) : ""}
                    onDone={(msg) => act(() => Promise.resolve({ data: null, error: null }), msg)}
                  />
                </div>
              ) : null}
              {revisions.length === 0 ? (
                <EmptyState title="No requests yet" body="Your client can request revisions or new work from their project link, or you can log what they asked on WhatsApp, a call or email." />
              ) : (
                <ul className="divide-y divide-line">
                  {revisions.map((r) => {
                    const d = p.deliverables.find((x) => x.id === r.deliverable_id);
                    const linkedCo = changeOrders.find((c) => c.revision_request_id === r.id && c.status !== "withdrawn");
                    return (
                      <li key={r.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{r.kind === "revision" ? `Revision · ${d?.title ?? "Deliverable"}` : "New work request"}</p>
                          {r.in_scope ? (
                            <Tag tone="accent">
                              In scope · {r.revision_number} of {d?.revisions_included}
                            </Tag>
                          ) : (
                            <Tag tone="warning">{r.kind === "revision" ? "Over revision limit" : "Outside original scope"}</Tag>
                          )}
                          <Tag tone={r.status === "resolved" ? "positive" : "neutral"}>
                            {r.status === "open" ? "Open" : r.status === "resolved" ? "Done" : `Change order #${linkedCo?.number ?? ""}`}
                          </Tag>
                        </div>
                        <p className="mt-1.5 whitespace-pre-line break-words text-[13px] text-ink-2">{r.description}</p>
                        <p className="mt-1 text-[12px] text-muted">
                          {r.requested_by} · {sourceLabel(r.source) ? `via ${sourceLabel(r.source)}${r.received_on ? ` on ${formatDate(r.received_on)}` : ""} · logged ` : ""}
                          {formatDateTime(r.created_at)}
                        </p>
                        {r.resolution_note ? <p className="mt-1 text-[12px] text-muted">Note: {r.resolution_note}</p> : null}
                        {r.status === "open" && p.status === "active" ? (
                          <div className="mt-3 flex flex-wrap items-start gap-2">
                            {!r.in_scope ? (
                              <LinkButton size="sm" to={`/projects/${pid}/change-orders/new?request=${r.id}`}>
                                {r.kind === "revision" && p.extra_revision_cents !== null && p.extra_revision_cents !== undefined
                                  ? `Charge extra round · ${fmt(Number(p.extra_revision_cents))}`
                                  : "Propose change order"}
                              </LinkButton>
                            ) : null}
                            <NoteAction
                              label={r.in_scope ? "Mark done" : "Do it anyway"}
                              placeholder="Optional note for the client"
                              maxLength={2000}
                              onSubmit={(note) =>
                                act(() => supabase.rpc("resolve_revision", { p_revision_id: r.id, p_note: note }), "Request marked as done.")
                              }
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : null}

          {/* -------------------------------------------- change orders */}
          {approved ? (
            <Card>
              <CardHeader
                title="Change orders"
                description="Out-of-scope work, priced and approved before it starts."
                action={
                  p.status === "active" ? (
                    <LinkButton size="sm" variant="secondary" to={`/projects/${pid}/change-orders/new`}>
                      New
                    </LinkButton>
                  ) : null
                }
              />
              {changeOrders.length === 0 ? (
                <EmptyState title="No change orders" body="When a client asks for something outside the approved scope, propose a change order here." />
              ) : (
                <ul className="divide-y divide-line">
                  {changeOrders.map((c) => (
                    <li key={c.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            #{c.number} · {c.title}
                          </p>
                          {c.description ? <p className="mt-0.5 whitespace-pre-line text-[13px] text-muted">{c.description}</p> : null}
                          <p className="num mt-1 text-[12px] text-muted">
                            {c.pricing_type === "hourly" && c.hourly_rate_cents !== null ? `${Number(c.hours)} h × ${fmt(Number(c.hourly_rate_cents))} · ` : ""}
                            {c.additional_days ? `+${pluralize(c.additional_days, "day")} · ` : ""}
                            Sent {formatDate(c.created_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="num text-sm font-semibold">{fmt(Number(c.amount_cents))}</p>
                          <div className="mt-1">
                            <CoStatus c={c} />
                          </div>
                        </div>
                      </div>
                      {c.status === "sent" ? (
                        <ActionButton
                          className="mt-3"
                          size="sm"
                          variant="ghost"
                          confirm="Withdraw this change order?"
                          onAction={() => act(() => supabase.rpc("withdraw_change_order", { p_change_order_id: c.id }), "Change order withdrawn.")}
                        >
                          Withdraw
                        </ActionButton>
                      ) : null}
                      {c.status === "approved" && !c.work_completed_at ? (
                        <ActionButton
                          className="mt-3"
                          size="sm"
                          variant="secondary"
                          onAction={() =>
                            act(() => supabase.rpc("complete_change_order_work", { p_change_order_id: c.id }), "Additional work marked as delivered.")
                          }
                        >
                          Mark work delivered
                        </ActionButton>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {/* -------------------------------------------- versions */}
          <Card>
            <CardHeader title="Approval timeline" description="Every version sent is stored permanently with a fingerprint of its exact content." />
            {snapshots.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">Not sent yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {snapshots.map((s) => {
                  const d = decisions.find((x) => x.snapshot_id === s.id);
                  const opened = activity.find((a) => a.event === "scope.viewed" && a.metadata?.snapshot_id === s.id);
                  const waiting = !d && s.id === latest?.id && p.status === "awaiting_approval";
                  return (
                    <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          Version {s.version} <span className="font-mono text-[12px] font-normal text-muted">{shortHash(s.content_hash)}</span>
                        </p>
                        <ol className="mt-2 space-y-1 text-[12px] text-muted">
                          <TimelineStep done label={`Sent ${formatDateTime(s.created_at)}`} />
                          {opened ? (
                            <TimelineStep done label={`Opened by client ${formatDateTime(opened.created_at)}`} />
                          ) : waiting ? (
                            <TimelineStep label="Not opened yet" />
                          ) : null}
                          {d ? (
                            <TimelineStep
                              done
                              tone={d.decision === "approved" ? "positive" : "danger"}
                              label={`${d.decision === "approved" ? "Approved" : "Changes requested"} by ${d.client_name} ${formatDateTime(d.created_at)}`}
                            />
                          ) : null}
                        </ol>
                        {d?.comment ? <p className="mt-1.5 break-words text-[13px] text-ink-2">“{d.comment}”</p> : null}
                      </div>
                      {d ? (
                        <Tag tone={d.decision === "approved" ? "positive" : "danger"}>{d.decision === "approved" ? "Approved" : "Changes requested"}</Tag>
                      ) : (
                        <Tag>{s.id === latest?.id && p.status === "awaiting_approval" ? "Awaiting decision" : "Superseded"}</Tag>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* ================================================ sidebar */}
        <div className="min-w-0 space-y-6">
          <LinkCard
            link={link}
            sent={snapshots.length > 0}
            cancelled={p.status === "cancelled"}
            days={linkDays}
            setDays={setLinkDays}
            onRotate={rotate}
            onRevoke={() => act(() => supabase.rpc("revoke_share_link", { p_project_id: pid }), "Client link revoked.")}
          />

          <Card>
            <div id="payments" className="scroll-mt-24" />
            <CardHeader title="Payments" description="Tracking only — record payments you've received." />
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line px-5 py-4 text-[13px]" data-testid="payment-totals">
              <dt className="text-muted">Original budget</dt>
              <dd className="text-right">{fmt(money.original)}</dd>
              <dt className="text-muted">Approved changes</dt>
              <dd className="text-right">{money.extras ? `+ ${fmt(money.extras)}` : "—"}</dd>
              <dt className="font-medium">Contract total</dt>
              <dd className="text-right font-semibold">{fmt(money.contract)}</dd>
              <dt className="text-muted">Received</dt>
              <dd className="text-right text-positive">{fmt(money.paid)}</dd>
              <dt className="text-muted">Outstanding</dt>
              <dd className="text-right">{fmt(money.outstanding)}</dd>
              {spent ? (
                <>
                  <dt className="text-muted">Expenses (linked)</dt>
                  <dd className="text-right">−{fmt(spent)}</dd>
                  <dt className="font-medium">Profit so far</dt>
                  <dd className={`text-right font-semibold ${money.paid - spent < 0 ? "text-danger" : ""}`} data-testid="project-profit-so-far">
                    {fmt(money.paid - spent)}
                  </dd>
                </>
              ) : null}
            </dl>
            {money.contract > 0 ? (
              <div className="border-b border-line px-5 py-3">
                <Meter value={money.paid} max={money.contract} tone="positive" />
              </div>
            ) : null}
            {p.milestones.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted">No milestones scheduled.</p>
            ) : (
              <ul className="divide-y divide-line">
                {p.milestones.map((m) => (
                  <li key={m.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{m.title}</p>
                        <p className="break-words text-[12px] text-muted">
                          {m.status === "paid"
                            ? `Paid in full · ${formatDate(m.paid_at)}`
                            : received(m) > 0
                              ? `Part paid · ${fmt(received(m))} of ${fmt(Number(m.amount_cents))}`
                              : m.due_date
                                ? `Due ${formatDate(m.due_date)}`
                                : "No due date"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {m.status === "paid" ? <Tag tone="positive">Paid</Tag> : received(m) > 0 ? <Tag tone="accent">Part paid</Tag> : null}
                        <p className="num text-[13px] font-medium">{fmt(Number(m.amount_cents))}</p>
                      </div>
                    </div>
                    {payments.some((x) => x.milestone_id === m.id) ? (
                      <ul className="mt-2 space-y-1 rounded-md bg-canvas px-3 py-2 text-[12px]" data-testid="payment-records">
                        {payments
                          .filter((x) => x.milestone_id === m.id)
                          .map((x) => (
                            <li key={x.id} className="flex items-start justify-between gap-2">
                              <span className="min-w-0 break-words text-ink-2">
                                {formatDate(x.paid_on)} · {methodLabel(x.method)}
                                {x.reference ? ` · ${x.reference}` : ""}
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="num">{fmt(Number(x.amount_cents))}</span>
                                {p.status !== "cancelled" ? (
                                  <ActionButton
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-1.5 text-[11px]"
                                    aria-label={`Remove payment of ${fmt(Number(x.amount_cents))} on ${formatDate(x.paid_on)}`}
                                    confirm={`Remove this ${fmt(Number(x.amount_cents))} payment? The amount goes back to "due".`}
                                    onAction={() => act(() => supabase.rpc("delete_payment", { p_payment_id: x.id }), "Payment removed.")}
                                  >
                                    Remove
                                  </ActionButton>
                                ) : null}
                              </span>
                            </li>
                          ))}
                      </ul>
                    ) : null}
                    {liveInvoice(m.id) ? (
                      <Link to={`/invoices/${liveInvoice(m.id)!.id}`} className="mt-2 inline-flex text-[12px] font-medium text-accent hover:underline">
                        Invoice {liveInvoice(m.id)!.number} →
                      </Link>
                    ) : approved && p.status !== "cancelled" ? (
                      <div className="mt-2">
                        <CreateInvoice
                          milestoneId={m.id}
                          taxBps={p.tax_bps ?? null}
                          taxLabel={p.tax_label ?? null}
                          sellerGstin={profile.data?.gstin}
                          buyerGstin={p.clients.gstin}
                        />
                      </div>
                    ) : null}
                    {approved && p.status !== "cancelled" && m.status !== "paid" ? (
                      <div className="mt-2">
                        <RecordPayment
                          milestoneId={m.id}
                          due={Number(m.amount_cents) - received(m)}
                          currency={p.currency}
                          onDone={(msg) => act(() => Promise.resolve({ data: null, error: null }), msg)}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {money.unscheduled > 0 && p.milestones.length ? (
              <p className="num border-t border-line px-5 py-3 text-[12px] text-warning">{fmt(money.unscheduled)} of the contract isn&apos;t covered by a milestone.</p>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Key dates" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-[13px]">
              <dt className="text-muted">Start</dt>
              <dd className="text-right">{formatDate(p.start_date)}</dd>
              <dt className="text-muted">Original due date</dt>
              <dd className="text-right">{formatDate(p.due_date)}</dd>
              <dt className="text-muted">Extensions</dt>
              <dd className="text-right">{p.extra_days ? `+ ${pluralize(p.extra_days, "day")}` : "—"}</dd>
              <dt className="font-medium">Current due date</dt>
              <dd className="text-right font-semibold">{formatDate(due)}</dd>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Follow-ups" description="Your own reminders for this project. They appear in the dashboard's Reminders on the day." />
            {followUps.length ? (
              <ul className="divide-y divide-line" data-testid="project-follow-ups">
                {followUps.map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-3 px-5 py-3 text-[13px]">
                    <div className="min-w-0">
                      <p className="break-words">{f.note}</p>
                      <p className="text-[12px] text-muted">{formatDate(f.due_on)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <ActionButton size="sm" variant="ghost" onAction={() => act(() => supabase.rpc("set_follow_up_done", { p_follow_up_id: f.id, p_done: true }), "Follow-up done.")}>
                        Done
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete follow-up ${f.note}`}
                        confirm="Delete this follow-up?"
                        onAction={() => act(() => supabase.rpc("delete_follow_up", { p_follow_up_id: f.id }), "Follow-up deleted.")}
                      >
                        Delete
                      </ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="px-5 py-3">
              <AddFollowUp projectId={pid} />
            </div>
          </Card>

          <ProjectTimeline activity={activity} />

          <div className="flex flex-wrap gap-2">
            {p.status === "awaiting_approval" ? (
              <ActionButton
                size="sm"
                variant="secondary"
                confirm="Recall this scope to edit it? Your client can't approve it until you send it again."
                onAction={() => act(() => supabase.rpc("recall_scope", { p_project_id: pid }), "Scope recalled. Edit it and send it again when ready.")}
              >
                Recall scope to edit
              </ActionButton>
            ) : null}
            {p.status === "active" ? (
              <ActionButton
                size="sm"
                variant="secondary"
                confirm="Mark this project as completed?"
                onAction={() => act(() => supabase.rpc("complete_project", { p_project_id: pid }), "Project marked as completed.")}
              >
                Mark completed
              </ActionButton>
            ) : null}
            {p.status === "draft" && snapshots.length === 0 ? (
              <DeleteDraft id={pid} />
            ) : p.status !== "completed" && p.status !== "cancelled" ? (
              <ActionButton
                size="sm"
                variant="danger"
                confirm="Cancel this project? Records are kept, but no further approvals can be made."
                onAction={() => act(() => supabase.rpc("cancel_project", { p_project_id: pid }), "Project cancelled. Pending change orders were withdrawn.")}
              >
                Cancel project
              </ActionButton>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function DeleteDraft({ id }: { id: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <ActionButton
      size="sm"
      variant="danger"
      confirm="Delete this draft permanently?"
      onAction={async () => {
        const r = await call(() => supabase.rpc("delete_draft_project", { p_project_id: id }));
        if (!r.ok) return toast("danger", r.message);
        await qc.invalidateQueries();
        toast("info", "Draft deleted.");
        navigate("/dashboard", { replace: true });
      }}
    >
      Delete draft
    </ActionButton>
  );
}

function LinkCard({
  link,
  sent,
  cancelled,
  days,
  setDays,
  onRotate,
  onRevoke,
}: {
  link: ShareLinkStatus | null;
  sent: boolean;
  cancelled: boolean;
  days: number;
  setDays: (d: number) => void;
  onRotate: () => Promise<unknown>;
  onRevoke: () => Promise<unknown>;
}) {
  const expired = link ? Date.parse(link.expires_at) <= Date.now() : false;
  let status: ReactNode;
  if (link && !expired)
    status = (
      <p className="text-[13px] text-ink-2">
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-positive align-middle" aria-hidden />
        Active · works until <strong className="font-medium">{formatDate(link.expires_at)}</strong>
        <span className="block text-[12px] text-muted">Created {formatDateTime(link.created_at)}</span>
      </p>
    );
  else if (link && expired) status = <p className="text-[13px] text-danger">Expired on {formatDate(link.expires_at)}. Your client can't open it.</p>;
  else status = <p className="text-[13px] text-muted">{sent ? "No active link. Your client can't open the project." : "A link is created when you send the scope."}</p>;

  return (
    <Card>
      <CardHeader title="Client link" description="Private, no account needed. Shown once when created — only a fingerprint is stored." />
      <div className="space-y-4 p-5">
        {status}
        {!cancelled ? (
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>Valid for</span>
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 w-auto text-[13px]" aria-label="Link validity">
                {LINK_VALIDITY_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </label>
            {sent || link ? (
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  size="sm"
                  variant={link && !expired ? "secondary" : "primary"}
                  confirm={link && !expired ? "Create a new link? The current link will stop working immediately." : undefined}
                  onAction={onRotate}
                >
                  {link && !expired ? "Replace link" : "Create new link"}
                </ActionButton>
                {link && !expired ? (
                  <ActionButton size="sm" variant="ghost" confirm="Revoke the link? Your client will lose access until you create a new one." onAction={onRevoke}>
                    Revoke
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function NoteAction({
  label,
  submitLabel = "Confirm",
  placeholder,
  maxLength,
  onSubmit,
}: {
  label: string;
  submitLabel?: string;
  placeholder: string;
  maxLength: number;
  onSubmit: (note: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!open)
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setPending(true);
        await onSubmit(String(new FormData(e.currentTarget).get("note") ?? "").slice(0, maxLength));
        setPending(false);
        setOpen(false);
      }}
    >
      <Input name="note" placeholder={placeholder} className="h-8 w-56 max-w-full text-[13px]" maxLength={maxLength} autoFocus />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "…" : submitLabel}
      </Button>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function CoStatus({ c }: { c: ChangeOrder }) {
  if (c.status === "sent") return <Tag tone="warning">Awaiting client</Tag>;
  if (c.status === "approved") return <Tag tone="positive">{c.work_completed_at ? "Approved · delivered" : "Approved"}</Tag>;
  if (c.status === "rejected") return <Tag tone="danger">Declined</Tag>;
  return <Tag>Withdrawn</Tag>;
}

function NextStep({
  p,
  latest,
  decision,
  revisions,
  changeOrders,
}: {
  p: FullProject;
  latest?: ScopeSnapshot;
  decision?: ScopeDecision;
  revisions: RevisionRequest[];
  changeOrders: ChangeOrder[];
}) {
  let content: ReactNode = null;
  let tone: "info" | "warning" | "danger" = "info";
  if (p.status === "draft") {
    content = latest
      ? "You recalled the scope. Edit it if needed, then send it again."
      : "Review the scope, then send it. You'll get a private link to share with your client for approval.";
  } else if (p.status === "awaiting_approval") {
    content = `Waiting for ${p.clients.name} to review version ${latest?.version ?? 1}.`;
  } else if (p.status === "changes_requested") {
    tone = "danger";
    content = (
      <>
        <strong className="font-semibold">{decision?.client_name ?? p.clients.name} asked for changes:</strong> “{decision?.comment}” — edit the scope and
        send the revised version.
      </>
    );
  } else if (p.status === "active") {
    const flagged = revisions.filter((r) => r.status === "open" && !r.in_scope).length;
    const pending = changeOrders.filter((c) => c.status === "sent").length;
    if (flagged) {
      tone = "warning";
      content = `${pluralize(flagged, "request")} from your client ${flagged === 1 ? "falls" : "fall"} outside the approved scope. Propose a change order or do the work anyway.`;
    } else if (pending) content = `${pluralize(pending, "change order")} awaiting your client's decision.`;
    else return null;
  } else return null;
  return (
    <div className="mb-6">
      <Alert tone={tone}>{content}</Alert>
    </div>
  );
}

function TimelineStep({ label, done = false, tone = "accent" }: { label: string; done?: boolean; tone?: "accent" | "positive" | "danger" }) {
  const dot = !done ? "border border-line-strong bg-surface" : tone === "positive" ? "bg-positive" : tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <li className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className={done ? "text-ink-2" : undefined}>{label}</span>
    </li>
  );
}

/** Not started / In progress / Delivered for one deliverable. */
function ProgressControl({ title, value, disabled, onChange }: { title: string; value: Progress; disabled: boolean; onChange: (p: Progress) => Promise<unknown> }) {
  const [pending, setPending] = useState<Progress | null>(null);
  return (
    <div className="mt-3 inline-flex rounded-lg border border-line bg-canvas p-0.5" role="radiogroup" aria-label={`${title} progress`}>
      {PROGRESS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || pending !== null}
            onClick={async () => {
              if (on) return;
              setPending(o.value);
              await onChange(o.value);
              setPending(null);
            }}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-60 ${
              on ? (o.value === "delivered" ? "bg-positive text-white" : o.value === "in_progress" ? "bg-accent text-white" : "bg-surface text-ink shadow-sm") : "text-muted hover:text-ink"
            }`}
          >
            {pending === o.value ? "…" : o.label}
          </button>
        );
      })}
    </div>
  );
}

type TimelineFilter = "all" | "client" | "money" | "scope" | "progress";
const TIMELINE_FILTERS: { value: TimelineFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "client", label: "Client" },
  { value: "scope", label: "Scope & changes" },
  { value: "progress", label: "Progress" },
  { value: "money", label: "Payments" },
];
function timelineKind(event: string): Exclude<TimelineFilter, "all" | "client"> {
  if (/^(milestone|invoice)\./.test(event)) return "money";
  if (/^deliverable\./.test(event) || /^project\.(completed|cancelled)/.test(event)) return "progress";
  return "scope";
}
const KIND_DOT: Record<Exclude<TimelineFilter, "all" | "client">, string> = {
  money: "bg-positive",
  progress: "bg-warning",
  scope: "bg-line-strong",
};

/** Everything that happened on the project, newest first, grouped by day. */
function ProjectTimeline({ activity }: { activity: { id: string; event: string; actor: string; summary: string; created_at: string }[] }) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const shown = activity.filter((a) => filter === "all" || (filter === "client" ? a.actor === "client" : timelineKind(a.event) === filter));
  const days = new Map<string, typeof shown>();
  for (const a of shown) {
    const day = formatDate(a.created_at);
    days.set(day, [...(days.get(day) ?? []), a]);
  }
  return (
    <Card>
      <div id="history" className="scroll-mt-24" />
      <CardHeader title="Project timeline" description="Approvals, requests, changes, progress and payments: everything, with dates." />
      <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2" role="tablist" aria-label="Filter timeline">
        {TIMELINE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-2.5 py-1 text-[12px] ${filter === f.value ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">Nothing here yet.</p>
      ) : (
        <div className="max-h-[560px] overflow-y-auto px-5 py-4" data-testid="project-timeline">
          {[...days].map(([day, items]) => (
            <section key={day} className="mb-4 last:mb-0">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{day}</h3>
              <ol className="space-y-3 border-l border-line pl-4">
                {items.map((a) => (
                  <li key={a.id} className="relative text-[13px]">
                    <span
                      className={`absolute -left-[20.5px] top-[6px] size-2 rounded-full ring-2 ring-surface ${a.actor === "client" ? "bg-accent" : KIND_DOT[timelineKind(a.event)]}`}
                      aria-hidden
                    />
                    <p className="text-ink-2">{a.summary}</p>
                    <p className="text-[12px] text-muted">
                      {a.actor === "client" ? "Client · " : ""}
                      {new Date(a.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

/** "Due Nov 20" for a deliverable, flagged when it's close or late and not yet delivered. */
function DeliverableDue({ due, delivered, extended }: { due: string; delivered: boolean; extended: boolean }) {
  const today = localToday();
  const left = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted" data-testid="deliverable-due">
      <span>
        Due {formatDate(due)}
        {extended ? " (incl. change-order extensions)" : ""}
      </span>
      {!delivered && left < 0 ? <Tag tone="danger">{-left === 1 ? "1 day late" : `${-left} days late`}</Tag> : null}
      {!delivered && left >= 0 && left <= 3 ? <Tag tone="warning">{left === 0 ? "Due today" : left === 1 ? "Due tomorrow" : `Due in ${left} days`}</Tag> : null}
    </p>
  );
}

/** Phones: the project page is long, so a sticky row of links jumps to each part. */
function JumpLinks({ links }: { links: { href: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="sticky top-14 z-20 -mx-4 mb-4 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur lg:hidden print:hidden" data-testid="jump-links">
      <ul className="flex gap-2 overflow-x-auto">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="inline-block whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink-2 hover:text-ink">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
