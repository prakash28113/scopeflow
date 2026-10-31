import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  Input,
  LinkButton,
  Meter,
  PageHeader,
  StatusBadge,
  Tag,
  buttonClass,
} from "@/components/ui";
import { ConfirmSubmit, CopyButton, SubmitButton } from "@/components/form-bits";
import { Flash } from "@/components/flash";
import { readFlash } from "@/lib/flash";
import { requireUser } from "@/lib/supabase/server";
import { getActiveShareUrl } from "@/lib/share-links";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, pluralize, shortHash } from "@/lib/format";
import { currentDueDate, projectTotals } from "@/lib/pricing";
import type {
  ActivityEntry,
  ChangeOrder,
  Client,
  Deliverable,
  EmailLogEntry,
  Milestone,
  Project,
  RevisionRequest,
  ScopeDecision,
  ScopeSnapshot,
} from "@/lib/types";
import * as act from "../actions";

export const metadata: Metadata = { title: "Project" };

type Full = Project & { clients: Client; deliverables: Deliverable[]; milestones: Milestone[] };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("projects")
    .select("*, clients(*), deliverables(*), milestones(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const p = data as Full;

  const [snapsRes, decRes, revRes, coRes, actRes, mailRes, shareUrl, flash] = await Promise.all([
    supabase.from("scope_snapshots").select("*").eq("project_id", id).order("version", { ascending: false }),
    supabase.from("scope_decisions").select("*").eq("project_id", id),
    supabase.from("revision_requests").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("change_orders").select("*").eq("project_id", id).order("number", { ascending: false }),
    supabase.from("activity_log").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(60),
    supabase.from("email_log").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(10),
    getActiveShareUrl(supabase, id),
    readFlash(),
  ]);

  const snapshots = (snapsRes.data ?? []) as ScopeSnapshot[];
  const decisions = (decRes.data ?? []) as ScopeDecision[];
  const revisions = (revRes.data ?? []) as RevisionRequest[];
  const changeOrders = (coRes.data ?? []) as ChangeOrder[];
  const activity = (actRes.data ?? []) as ActivityEntry[];
  const emails = (mailRes.data ?? []) as EmailLogEntry[];

  const deliverables = [...p.deliverables].sort((a, b) => a.position - b.position);
  const milestones = [...p.milestones].sort((a, b) => a.position - b.position);
  const latest = snapshots[0];
  const latestDecision = latest ? decisions.find((d) => d.snapshot_id === latest.id) : undefined;
  const editable = p.status === "draft" || p.status === "changes_requested";
  const approved = Boolean(p.approved_at);
  const money = projectTotals(Number(p.budget_cents), Number(p.approved_extras_cents), milestones);
  const due = currentDueDate(p.due_date, p.extra_days);
  const used = (dId: string) => revisions.filter((r) => r.deliverable_id === dId && r.kind === "revision" && r.in_scope).length;
  const fmt = (n: number) => formatMoney(n, p.currency);
  const lastScopeEmail = emails.find((e) => e.template === "scope_sent");

  return (
    <>
      <Flash flash={flash} />
      <PageHeader
        eyebrow={
          <Link href="/dashboard" className="hover:text-ink">
            ← Dashboard
          </Link>
        }
        title={p.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            <span>
              {p.clients.name}
              {p.clients.company ? ` · ${p.clients.company}` : ""} · {p.clients.email}
            </span>
          </span>
        }
        actions={
          <>
            {editable ? (
              <LinkButton href={`/projects/${id}/edit`} variant="secondary">
                Edit scope
              </LinkButton>
            ) : null}
            {editable ? (
              <form action={act.sendScope.bind(null, id)}>
                <SubmitButton pendingLabel="Sending…">{p.status === "changes_requested" ? "Send revised scope" : "Send to client"}</SubmitButton>
              </form>
            ) : null}
            {p.status === "active" ? (
              <LinkButton href={`/projects/${id}/change-orders/new`}>New change order</LinkButton>
            ) : null}
          </>
        }
      />

      <NextStep p={p} latest={latest} decision={latestDecision} revisions={revisions} changeOrders={changeOrders} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {/* ---------------------------------------------------- scope */}
          <Card>
            <CardHeader
              title="Scope"
              description={
                approved
                  ? `Approved ${formatDate(p.approved_at)} — changes go through change orders.`
                  : editable
                    ? "Draft — editable until your client approves it."
                    : "Locked while your client reviews it."
              }
            />
            {p.summary ? <p className="whitespace-pre-line border-b border-line px-5 py-4 text-sm text-ink-2">{p.summary}</p> : null}
            <ul className="divide-y divide-line">
              {deliverables.map((d) => {
                const u = used(d.id);
                return (
                  <li key={d.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{d.title}</p>
                        {d.description ? <p className="mt-0.5 whitespace-pre-line text-[13px] text-muted">{d.description}</p> : null}
                      </div>
                      <p className="num shrink-0 text-[13px] text-ink-2">
                        {approved ? `${u} / ${d.revisions_included}` : pluralize(d.revisions_included, "revision")}
                      </p>
                    </div>
                    {approved ? (
                      <div className="mt-3 max-w-xs">
                        <Meter value={u} max={d.revisions_included} tone={u >= d.revisions_included ? "warning" : "accent"} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* ---------------------------------------------------- requests */}
          {approved ? (
            <Card>
              <div id="requests" className="scroll-mt-20" />
              <CardHeader
                title="Revision & change requests"
                description="Each request is checked against the approved scope when the client submits it."
              />
              {revisions.length === 0 ? (
                <EmptyState title="No requests yet" body="Your client can request revisions or new work from their project link." />
              ) : (
                <ul className="divide-y divide-line">
                  {revisions.map((r) => {
                    const d = deliverables.find((x) => x.id === r.deliverable_id);
                    const linkedCo = changeOrders.find((c) => c.revision_request_id === r.id && c.status !== "withdrawn");
                    return (
                      <li key={r.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">
                            {r.kind === "revision" ? `Revision · ${d?.title ?? "Deliverable"}` : "New work request"}
                          </p>
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
                        <p className="mt-1.5 whitespace-pre-line text-[13px] text-ink-2">{r.description}</p>
                        <p className="mt-1 text-[12px] text-muted">
                          {r.requested_by} · {formatDateTime(r.created_at)}
                        </p>
                        {r.resolution_note ? <p className="mt-1 text-[12px] text-muted">Note: {r.resolution_note}</p> : null}
                        {r.status === "open" && p.status === "active" ? (
                          <div className="mt-3 flex flex-wrap items-start gap-2">
                            {!r.in_scope ? (
                              <LinkButton size="sm" href={`/projects/${id}/change-orders/new?request=${r.id}`}>
                                Propose change order
                              </LinkButton>
                            ) : null}
                            <details className="group">
                              <summary className={buttonClass("secondary", "sm") + " list-none cursor-pointer"}>
                                {r.in_scope ? "Mark done" : "Do it anyway"}
                              </summary>
                              <form action={act.resolveRevision.bind(null, id, r.id)} className="mt-2 flex gap-2">
                                <Input name="note" placeholder="Optional note for the client" className="h-8 w-56 text-[13px]" maxLength={2000} />
                                <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                                  Confirm
                                </SubmitButton>
                              </form>
                            </details>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : null}

          {/* ---------------------------------------------------- change orders */}
          {approved ? (
            <Card>
              <CardHeader
                title="Change orders"
                description="Out-of-scope work, priced and approved before it starts."
                action={
                  p.status === "active" ? (
                    <LinkButton size="sm" variant="secondary" href={`/projects/${id}/change-orders/new`}>
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
                            {c.pricing_type === "hourly" && c.hourly_rate_cents !== null
                              ? `${Number(c.hours)} h × ${fmt(Number(c.hourly_rate_cents))} · `
                              : ""}
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
                        <form action={act.withdrawChangeOrder.bind(null, id, c.id)} className="mt-3">
                          <ConfirmSubmit size="sm" variant="ghost" message="Withdraw this change order?" pendingLabel="…">
                            Withdraw
                          </ConfirmSubmit>
                        </form>
                      ) : null}
                      {c.status === "approved" && !c.work_completed_at ? (
                        <form action={act.completeChangeOrderWork.bind(null, id, c.id)} className="mt-3">
                          <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                            Mark work delivered
                          </SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {/* ---------------------------------------------------- history */}
          <Card>
            <CardHeader title="Scope versions" description="Every version sent is stored permanently with a fingerprint of its exact content." />
            {snapshots.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">Not sent yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {snapshots.map((s) => {
                  const d = decisions.find((x) => x.snapshot_id === s.id);
                  return (
                    <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                      <div>
                        <p className="text-sm font-medium">Version {s.version}</p>
                        <p className="text-[12px] text-muted">
                          Sent {formatDateTime(s.created_at)} · <span className="font-mono">{shortHash(s.content_hash)}</span>
                        </p>
                        {d?.comment ? <p className="mt-1 text-[13px] text-ink-2">“{d.comment}”</p> : null}
                      </div>
                      {d ? (
                        <div className="text-right">
                          <Tag tone={d.decision === "approved" ? "positive" : "danger"}>
                            {d.decision === "approved" ? "Approved" : "Changes requested"}
                          </Tag>
                          <p className="mt-1 text-[12px] text-muted">
                            {d.client_name} · {formatDateTime(d.created_at)}
                          </p>
                        </div>
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

        {/* ====================================================== sidebar */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Client link" description="No account needed. Anyone with the link can view and respond." />
            <div className="space-y-3 p-5">
              {shareUrl ? (
                <>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-sunken px-2.5 py-1.5 text-[12px] text-ink-2">
                      {shareUrl}
                    </code>
                    <CopyButton value={shareUrl} label="Copy" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={shareUrl} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
                      Preview
                    </a>
                    <form action={act.rotateLink.bind(null, id)}>
                      <ConfirmSubmit size="sm" variant="ghost" message="Create a new link? The current link will stop working." pendingLabel="…">
                        New link
                      </ConfirmSubmit>
                    </form>
                    <form action={act.revokeLink.bind(null, id)}>
                      <ConfirmSubmit size="sm" variant="ghost" message="Revoke the link? Your client will lose access until you create a new one." pendingLabel="…">
                        Revoke
                      </ConfirmSubmit>
                    </form>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted">
                    {snapshots.length ? "The link was revoked." : "A link is created when you send the scope."}
                  </p>
                  {snapshots.length ? (
                    <form action={act.rotateLink.bind(null, id)}>
                      <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                        Create link
                      </SubmitButton>
                    </form>
                  ) : null}
                </>
              )}
              {lastScopeEmail ? (
                <p className="text-[12px] text-muted">
                  Last scope email:{" "}
                  {lastScopeEmail.status === "sent"
                    ? `delivered to ${lastScopeEmail.recipient}`
                    : lastScopeEmail.status === "skipped"
                      ? "not sent (email not configured)"
                      : "failed to send"}{" "}
                  · {formatDateTime(lastScopeEmail.created_at)}
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Payments" description="Tracking only — record payments you've received." />
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line px-5 py-4 text-[13px]">
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
            </dl>
            {money.contract > 0 ? (
              <div className="border-b border-line px-5 py-3">
                <Meter value={money.paid} max={money.contract} tone="positive" />
              </div>
            ) : null}
            {milestones.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted">No milestones scheduled.</p>
            ) : (
              <ul className="divide-y divide-line">
                {milestones.map((m) => (
                  <li key={m.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{m.title}</p>
                        <p className="text-[12px] text-muted">
                          {m.status === "paid"
                            ? `Paid ${formatDate(m.paid_at)}${m.payment_note ? ` · ${m.payment_note}` : ""}`
                            : m.due_date
                              ? `Due ${formatDate(m.due_date)}`
                              : "No due date"}
                        </p>
                      </div>
                      <p className="num text-[13px] font-medium">{fmt(Number(m.amount_cents))}</p>
                    </div>
                    {approved && p.status !== "cancelled" ? (
                      m.status === "paid" ? (
                        <form action={act.setMilestonePaid.bind(null, id, m.id, false)} className="mt-2">
                          <ConfirmSubmit size="sm" variant="ghost" message="Remove the paid mark from this milestone?" pendingLabel="…">
                            Undo paid
                          </ConfirmSubmit>
                        </form>
                      ) : (
                        <details className="mt-2">
                          <summary className={buttonClass("secondary", "sm") + " list-none cursor-pointer"}>Mark paid</summary>
                          <form action={act.setMilestonePaid.bind(null, id, m.id, true)} className="mt-2 flex gap-2">
                            <Input name="note" placeholder="Reference (optional)" className="h-8 text-[13px]" maxLength={500} />
                            <SubmitButton size="sm" pendingLabel="…">
                              Save
                            </SubmitButton>
                          </form>
                        </details>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {money.unscheduled > 0 && milestones.length ? (
              <p className="num border-t border-line px-5 py-3 text-[12px] text-warning">
                {fmt(money.unscheduled)} of the contract isn&apos;t covered by a milestone.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Timeline" />
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
            <CardHeader title="Activity" />
            <ol className="space-y-3.5 px-5 py-4">
              {activity.map((a) => (
                <li key={a.id} className="relative pl-4 text-[13px]">
                  <span
                    className={`absolute left-0 top-[7px] size-1.5 rounded-full ${a.actor === "client" ? "bg-accent" : "bg-line-strong"}`}
                    aria-hidden
                  />
                  <p className="text-ink-2">{a.summary}</p>
                  <p className="text-[12px] text-muted">{formatDateTime(a.created_at)}</p>
                </li>
              ))}
            </ol>
          </Card>

          {emails.length ? (
            <Card>
              <CardHeader title="Notifications" description="Emails ScopeFlow attempted for this project." />
              <ul className="divide-y divide-line">
                {emails.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[12px]">
                    <span className="min-w-0 truncate text-ink-2">
                      {e.template.replace(/_/g, " ")} → {e.recipient}
                    </span>
                    <Tag tone={e.status === "sent" ? "positive" : e.status === "failed" ? "danger" : "neutral"}>{e.status}</Tag>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {p.status === "awaiting_approval" ? (
              <form action={act.recallScope.bind(null, id)}>
                <ConfirmSubmit size="sm" variant="secondary" message="Recall this scope to edit it? Your client won't be able to approve it until you resend." pendingLabel="…">
                  Recall scope to edit
                </ConfirmSubmit>
              </form>
            ) : null}
            {p.status === "active" ? (
              <form action={act.completeProject.bind(null, id)}>
                <ConfirmSubmit size="sm" variant="secondary" message="Mark this project as completed?" pendingLabel="…">
                  Mark completed
                </ConfirmSubmit>
              </form>
            ) : null}
            {p.status === "draft" && snapshots.length === 0 ? (
              <form action={act.deleteDraft.bind(null, id)}>
                <ConfirmSubmit size="sm" variant="danger" message="Delete this draft permanently?" pendingLabel="…">
                  Delete draft
                </ConfirmSubmit>
              </form>
            ) : p.status !== "completed" && p.status !== "cancelled" ? (
              <form action={act.cancelProject.bind(null, id)}>
                <ConfirmSubmit size="sm" variant="danger" message="Cancel this project? Records are kept, but no further approvals can be made." pendingLabel="…">
                  Cancel project
                </ConfirmSubmit>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </>
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
  p: Full;
  latest?: ScopeSnapshot;
  decision?: ScopeDecision;
  revisions: RevisionRequest[];
  changeOrders: ChangeOrder[];
}) {
  let content: React.ReactNode = null;
  let tone: "info" | "warning" | "positive" | "danger" = "info";
  if (p.status === "draft") {
    content = latest
      ? "You recalled the scope. Edit it if needed, then send it again."
      : "Review the scope, then send it. Your client gets a private link to approve it or ask for changes.";
  } else if (p.status === "awaiting_approval") {
    content = `Waiting for ${p.clients.name} to review version ${latest?.version ?? 1}.`;
  } else if (p.status === "changes_requested") {
    tone = "danger";
    content = (
      <>
        <strong className="font-semibold">{decision?.client_name ?? p.clients.name} asked for changes:</strong>{" "}
        “{decision?.comment}” — edit the scope and send the revised version.
      </>
    );
  } else if (p.status === "active") {
    const flagged = revisions.filter((r) => r.status === "open" && !r.in_scope).length;
    const pending = changeOrders.filter((c) => c.status === "sent").length;
    if (flagged) {
      tone = "warning";
      content = `${pluralize(flagged, "request")} from your client ${flagged === 1 ? "falls" : "fall"} outside the approved scope. Propose a change order or do the work anyway.`;
    } else if (pending) {
      content = `${pluralize(pending, "change order")} awaiting your client's decision.`;
    } else return null;
  } else return null;
  return (
    <div className="mb-6">
      <Alert tone={tone}>{content}</Alert>
    </div>
  );
}
