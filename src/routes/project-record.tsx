import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, cx } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { DownloadPdfButton, PrintButton, QuoteTable } from "@/components/quote";
import { useProject } from "@/lib/queries";
import { displayName, useProfile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import { projectTotals } from "@/lib/pricing";
import { methodLabel } from "@/lib/payments";
import { describeUserAgent } from "@/lib/user-agent";
import { splitLines } from "@/lib/validation";
import NotFound from "./not-found";
import { FeatureLock } from "@/components/plans";
import { useFeature, useSoloPrice } from "@/lib/plans";

type Evidence = { user_agent: string | null; ip_address: string | null };
type FullDecision = { id: string; snapshot_id: string; decision: "approved" | "rejected"; comment: string | null; client_name: string; content_hash: string; created_at: string } & Evidence;
type CoDecision = { change_order_id: string; decision: "approved" | "rejected"; comment: string | null; client_name: string; created_at: string } & Evidence;
type LogEntry = { id: string; actor: string; actor_name: string | null; summary: string; created_at: string };

function Section({ n, title, children, empty }: { n: number; title: string; children: ReactNode; empty?: string | false }) {
  return (
    <section className="break-inside-avoid-page border-b border-line py-6 last:border-0">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">
        <span className="num text-muted">{n}.</span> {title}
      </h2>
      {empty ? <p className="text-[13px] text-muted">{empty}</p> : children}
    </section>
  );
}

function evidence(e: Evidence) {
  return [describeUserAgent(e.user_agent), e.ip_address ? `IP ${e.ip_address}` : null].filter(Boolean).join(" · ");
}

/**
 * A printable record of everything agreed on a project: the approved scope and its fingerprint,
 * every decision with time, browser and IP, change orders, revisions, payments and the full log.
 */
export default function ProjectRecordPage() {
  const { id } = useParams();
  const q = useProject(id);
  const profile = useProfile();
  const canExport = useFeature("exports");
  const price = useSoloPrice();
  const extra = useQuery({
    queryKey: ["project-record", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [decisions, coDecisions, log] = await Promise.all([
        supabase.from("scope_decisions").select("*").eq("project_id", id!).order("created_at"),
        supabase.from("change_order_decisions").select("change_order_id, decision, comment, client_name, created_at, user_agent, ip_address").eq("project_id", id!),
        supabase.from("activity_log").select("id, actor, actor_name, summary, created_at").eq("project_id", id!).order("created_at").limit(2000),
      ]);
      for (const r of [decisions, coDecisions, log]) if (r.error) throw r.error;
      return { decisions: decisions.data as FullDecision[], coDecisions: coDecisions.data as CoDecision[], log: log.data as LogEntry[] };
    },
  });
  if (q.isLoading || extra.isLoading || profile.isLoading) return <PageSpinner />;
  if (q.isError || extra.isError) return <Alert>Couldn't load this record. Please refresh.</Alert>;
  if (!q.data || !extra.data) return <NotFound />;

  const { project: p, snapshots, revisions, changeOrders, payments, invoices } = q.data;
  const { decisions, coDecisions, log } = extra.data;
  const fmt = (n: number) => formatMoney(Number(n), p.currency);
  const money = projectTotals(Number(p.budget_cents), Number(p.approved_extras_cents), p.milestones);
  const approvedDecision = [...decisions].reverse().find((d) => d.decision === "approved");
  const approvedSnap = approvedDecision ? snapshots.find((s) => s.id === approvedDecision.snapshot_id) : undefined;
  const scope = approvedSnap?.data;
  const from = profile.data ? profile.data.business_name || displayName(profile.data) : "";
  const deliverableTitle = new Map(p.deliverables.map((d) => [d.id, d.title]));
  const coDecision = new Map(coDecisions.map((d) => [d.change_order_id, d]));
  const decidedCos = changeOrders.filter((c) => c.status !== "withdrawn").sort((a, b) => a.number - b.number);
  const liveInvoices = invoices.filter((i) => !i.voided_at);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/projects/${p.id}`} className="text-[13px] text-muted hover:text-ink">
          ← {p.title}
        </Link>
        {canExport ? (
          <div className="flex gap-2">
            <PrintButton label="Print" size="md" />
            <DownloadPdfButton name={`Project record ${p.title}`} size="md" variant="primary" />
          </div>
        ) : null}
      </div>
      {canExport ? null : (
        <div className="mb-4 print:hidden">
          <FeatureLock compact title="PDF export is a Solo feature" body="Download or print this record as proof of everything agreed." price={price} />
        </div>
      )}
      {canExport ? null : <p className="hidden print:block">PDF export of the project record is available on ScopeFlow Solo.</p>}
      <article data-print-scope data-testid="project-record" className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10", !canExport && "print:hidden")}>
        <header className="border-b border-line pb-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">Project record</p>
          <h1 className="display mt-1 text-[26px] font-semibold leading-tight">{p.title}</h1>
          <p className="mt-1 text-[13px] text-muted">Generated {formatDateTime(new Date().toISOString())} from ScopeFlow records</p>
          <dl className="mt-4 grid gap-4 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Freelancer</dt>
              <dd className="mt-1 font-medium">{from}</dd>
              {profile.data?.email ? <dd className="text-ink-2">{profile.data.email}</dd> : null}
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Client</dt>
              <dd className="mt-1 font-medium">{p.clients.company || p.clients.name}</dd>
              {p.clients.company ? <dd>{p.clients.name}</dd> : null}
              <dd className="text-ink-2">{p.clients.email}</dd>
            </div>
          </dl>
        </header>

        <Section n={1} title="Summary">
          <dl className="num grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Scope approved</dt>
            <dd>{approvedDecision ? `${formatDateTime(approvedDecision.created_at)} by ${approvedDecision.client_name} (version ${approvedSnap?.version})` : "Not approved yet"}</dd>
            <dt className="text-muted">Original budget</dt>
            <dd>{fmt(money.original)}</dd>
            <dt className="text-muted">Approved changes</dt>
            <dd>{money.extras ? `+ ${fmt(money.extras)}` : "None"}</dd>
            <dt className="font-medium">Contract total</dt>
            <dd className="font-semibold">{fmt(money.contract)}</dd>
            <dt className="text-muted">Received</dt>
            <dd>{fmt(money.paid)}</dd>
            <dt className="text-muted">Contract unpaid</dt>
            <dd>{fmt(money.outstanding)}</dd>
          </dl>
        </Section>

        <Section n={2} title="Approved scope" empty={!scope && "No version of the scope has been approved yet."}>
          {scope && approvedDecision ? (
            <div className="space-y-4 text-[13px]">
              <div className="rounded-lg bg-canvas px-4 py-3">
                <p>
                  <span className="font-medium">Version {approvedSnap!.version}</span>, sent {formatDateTime(approvedSnap!.created_at)}, approved{" "}
                  {formatDateTime(approvedDecision.created_at)} by <span className="font-medium">{approvedDecision.client_name}</span>
                  {evidence(approvedDecision) ? ` · ${evidence(approvedDecision)}` : ""}.
                </p>
                <p className="mt-1 break-all text-[12px] text-ink-2">
                  Fingerprint (SHA-256 of the exact content approved): <span className="num font-mono">{approvedDecision.content_hash}</span>
                </p>
              </div>
              {scope.summary ? <p className="whitespace-pre-line text-ink-2">{scope.summary}</p> : null}
              <div>
                <h3 className="mb-1 font-semibold">Deliverables</h3>
                <ol className="list-decimal space-y-1 pl-5">
                  {scope.deliverables.map((d) => (
                    <li key={d.id}>
                      <span className="font-medium">{d.title}</span> · {pluralize(d.revisions_included, "revision round")} included
                      {(d as { due_date?: string | null }).due_date ? ` · due ${formatDate((d as { due_date?: string | null }).due_date)}` : ""}
                      {d.description ? <span className="block whitespace-pre-line text-ink-2">{d.description}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
              {scope.pricing ? <QuoteTable lines={scope.deliverables} pricing={scope.pricing} currency={scope.currency} /> : null}
              {splitLines(scope.exclusions).length ? (
                <div>
                  <h3 className="mb-1 font-semibold">Not included</h3>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {splitLines(scope.exclusions).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {scope.extra_revision_cents ? <p>Extra revision rounds: {formatMoney(scope.extra_revision_cents, scope.currency)} each.</p> : null}
              {scope.terms ? (
                <div>
                  <h3 className="mb-1 font-semibold">Terms</h3>
                  <p className="whitespace-pre-line text-ink-2">{scope.terms}</p>
                </div>
              ) : null}
              <p className="text-ink-2">
                Dates: start {formatDate(scope.start_date)}, due {formatDate(scope.due_date)}
                {p.extra_days ? ` (+${pluralize(p.extra_days, "day")} from approved change orders)` : ""}.
              </p>
            </div>
          ) : null}
        </Section>

        <Section n={3} title="Scope versions and client decisions" empty={!snapshots.length && "The scope hasn't been sent to the client."}>
          <ol className="space-y-2 text-[13px]">
            {[...snapshots].reverse().map((s) => {
              const d = decisions.find((x) => x.snapshot_id === s.id);
              return (
                <li key={s.id} className="border-l-2 border-line pl-3">
                  <p>
                    <span className="font-medium">Version {s.version}</span> sent {formatDateTime(s.created_at)}
                  </p>
                  <p className={cx(d?.decision === "approved" ? "text-positive" : d ? "text-warning" : "text-muted")}>
                    {d
                      ? `${d.decision === "approved" ? "Approved" : "Changes requested"} by ${d.client_name}, ${formatDateTime(d.created_at)}${evidence(d) ? ` · ${evidence(d)}` : ""}`
                      : "No decision"}
                  </p>
                  {d?.comment ? <p className="whitespace-pre-line text-ink-2">“{d.comment}”</p> : null}
                </li>
              );
            })}
          </ol>
        </Section>

        <Section n={4} title="Change orders" empty={!decidedCos.length && "No change orders."}>
          <ol className="space-y-2 text-[13px]">
            {decidedCos.map((c) => {
              const d = coDecision.get(c.id);
              return (
                <li key={c.id} className="border-l-2 border-line pl-3">
                  <p>
                    <span className="font-medium">
                      #{c.number} {c.title}
                    </span>{" "}
                    · <span className="num">{fmt(c.amount_cents)}</span>
                    {c.additional_days ? ` · +${pluralize(c.additional_days, "day")}` : ""} · sent {formatDateTime(c.created_at)}
                  </p>
                  <p className={cx(c.status === "approved" ? "text-positive" : c.status === "rejected" ? "text-warning" : "text-muted")}>
                    {d
                      ? `${d.decision === "approved" ? "Approved" : "Declined"} by ${d.client_name}, ${formatDateTime(d.created_at)}${evidence(d) ? ` · ${evidence(d)}` : ""}`
                      : "Waiting for the client"}
                    {c.work_completed_at ? ` · work completed ${formatDate(c.work_completed_at)}` : ""}
                  </p>
                  {d?.comment ? <p className="whitespace-pre-line text-ink-2">“{d.comment}”</p> : null}
                </li>
              );
            })}
          </ol>
        </Section>

        <Section n={5} title="Revision and new-work requests" empty={!revisions.length && "No requests."}>
          <ol className="space-y-2 text-[13px]">
            {[...revisions].reverse().map((r) => (
              <li key={r.id} className="border-l-2 border-line pl-3">
                <p>
                  {formatDateTime(r.created_at)} · {r.kind === "revision" ? "Revision" : "New work"}
                  {r.deliverable_id ? ` · ${deliverableTitle.get(r.deliverable_id) ?? "Deliverable"}` : ""} ·{" "}
                  <span className={r.in_scope ? "text-positive" : "text-warning"}>
                    {r.in_scope ? (r.revision_number ? `included round ${r.revision_number}` : "in scope") : "outside the agreed scope"}
                  </span>
                </p>
                <p className="whitespace-pre-line text-ink-2">“{r.description}”</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section n={6} title="Payments and invoices" empty={!payments.length && !liveInvoices.length && "No payments or invoices recorded."}>
          {payments.length ? (
            <table className="num mb-4 w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="pb-1 font-semibold">Received</th>
                  <th className="pb-1 font-semibold">For</th>
                  <th className="pb-1 font-semibold">Method</th>
                  <th className="pb-1 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((x) => (
                  <tr key={x.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2">{formatDate(x.paid_on)}</td>
                    <td className="py-1.5 pr-2">{p.milestones.find((m) => m.id === x.milestone_id)?.title ?? "Payment"}</td>
                    <td className="py-1.5 pr-2">
                      {methodLabel(x.method)}
                      {x.reference ? ` · ${x.reference}` : ""}
                    </td>
                    <td className="py-1.5 text-right">{fmt(x.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {liveInvoices.length ? (
            <p className="text-[13px] text-ink-2">Invoices issued: {liveInvoices.map((i) => i.number).join(", ")}.</p>
          ) : null}
        </Section>

        <Section n={7} title="Full activity log" empty={!log.length && "No activity."}>
          <ol className="space-y-1 text-[12px]">
            {log.map((a) => (
              <li key={a.id} className="grid grid-cols-[150px_1fr] gap-3">
                <span className="num text-muted">{formatDateTime(a.created_at)}</span>
                <span>
                  {a.summary}
                  {a.actor === "client" ? <span className="text-muted"> (client)</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </Section>

        <footer className="mt-6 text-[11px] leading-relaxed text-muted">
          How this record works: every version sent to the client is stored permanently and can't be edited. Its fingerprint is a SHA-256 hash of the exact
          content, so any change to an approved version would produce a different fingerprint. Client decisions are recorded with the time, the name the
          client entered, and their browser and IP address. This record is provided for reference and isn&apos;t legal advice.
        </footer>
      </article>
    </div>
  );
}
