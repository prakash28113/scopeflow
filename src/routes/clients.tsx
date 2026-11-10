import { LIMIT_LATER_LABEL, LIMIT_UPGRADE_LABEL, limitPrompt } from "@/lib/plan-copy";
import { planUrl } from "@/lib/plan-intent";
import { intentProps } from "@/lib/prefetch";
import { useState, type FormEvent } from "react";
import { methodLabel } from "@/lib/payments";
import { invoiceStatus } from "@/lib/invoice";
import { localToday } from "@/lib/upcoming";
import { received } from "@/lib/pricing";
import { OUTSTANDING_LABEL } from "@/lib/outstanding";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, LinkButton, PageHeader, Select, StatusBadge, Tag, Textarea, buttonClass } from "@/components/ui";
import { ActionButton, SubmitButton } from "@/components/form-bits";
import { PageSpinner } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { supabase } from "@/lib/supabase";
import { useAction } from "@/lib/use-action";
import { clientSchema } from "@/lib/validation";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { GST_STATES_SORTED, stateName, stateOf } from "@/lib/gst";
import { useMyPlan } from "@/lib/plans";
import type { ProjectStatus } from "@/lib/types";

type ClientProject = {
  id: string;
  title: string;
  status: ProjectStatus;
  currency: string;
  budget_cents: number;
  approved_extras_cents: number;
  created_at: string;
  milestones: { title: string; amount_cents: number; status: string; paid_at: string | null; payment_note: string | null }[];
  scope_decisions?: { decision: "approved" | "rejected"; client_name: string; created_at: string }[];
  change_orders?: { number: number; title: string; status: string; amount_cents: number; decided_at: string | null }[];
  client_invoices?: { id: string; number: string; issue_date: string; due_date: string | null; amount_cents: number; voided_at: string | null; milestones: { status: string; paid_cents: number } | null }[];
  payments?: { id: string; amount_cents: number; paid_on: string; method: string; reference: string | null }[];
  approved_at?: string | null;
};
type ClientRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  notes: string | null;
  billing_address?: string | null;
  gstin?: string | null;
  state_code?: string | null;
  archived_at?: string | null;
  created_at: string;
  projects: ClientProject[];
};

const OPEN: ProjectStatus[] = ["draft", "awaiting_approval", "changes_requested", "active"];

/** Contracted, paid and outstanding per currency (approved work only). */
function money(projects: ClientProject[]) {
  const by = new Map<string, { contracted: number; paid: number; count: number }>();
  for (const p of projects) {
    if (p.status !== "active" && p.status !== "completed") continue;
    const t = by.get(p.currency) ?? { contracted: 0, paid: 0, count: 0 };
    t.count += 1;
    t.contracted += Number(p.budget_cents) + Number(p.approved_extras_cents);
    t.paid += p.milestones.reduce((s, m) => s + received(m), 0);
    by.set(p.currency, t);
  }
  // Same definition as the dashboard (src/lib/outstanding.ts): contract minus received.
  return [...by.entries()].map(([currency, t]) => ({ currency, ...t, outstanding: Math.max(0, t.contracted - t.paid) }));
}

/** The client list (shared with prefetching, so opening Clients is instant). */
export const clientsQuery = {
  queryKey: ["clients"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, email, company, phone, notes, billing_address, gstin, state_code, archived_at, created_at, projects(id, title, status, currency, budget_cents, approved_extras_cents, created_at, milestones(title, amount_cents, status, paid_at, payment_note, paid_cents))")
      .order("name");
    if (error) throw error;
    return data as unknown as ClientRow[];
  },
};

export function ClientsPage() {
  const [params] = useSearchParams();
  const [adding, setAdding] = useState(params.get("new") === "1"); // the Get started checklist opens the form
  const [showArchived, setShowArchived] = useState(false);
  const q = useQuery(clientsQuery);
  const plan = useMyPlan();
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load your clients. Please refresh.</Alert>;
  const archived = q.data.filter((c) => c.archived_at);
  const shown = q.data.filter((c) => (showArchived ? c.archived_at : !c.archived_at));
  const limit = plan.data?.limits.clients ?? null;
  const atLimit = limit !== null && (plan.data?.usage.clients ?? 0) >= limit;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone you work with, with their projects, approvals, invoices and payments."
        actions={
          <Button type="button" onClick={() => setAdding(true)}>
            Add client
          </Button>
        }
      />
      {adding && atLimit ? (
        <Card className="mb-6" data-testid="client-limit">
          <div className="space-y-3 p-5">
            <p className="text-[15px] font-semibold text-ink" data-testid="limit-prompt">
              {limitPrompt("clients", limit ?? 0)}
            </p>
            <p className="text-[13px] text-ink-2">
              You have {limit} clients on Free. You can also archive a client you no longer work with (their records are kept), or delete one you added by mistake.
            </p>
            <div className="flex flex-wrap gap-2">
              <LinkButton to={planUrl({ plan: "solo", interval: "month" })}>{LIMIT_UPGRADE_LABEL}</LinkButton>
              <button type="button" className={buttonClass("ghost")} onClick={() => setAdding(false)}>
                {LIMIT_LATER_LABEL}
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <AddClient open={adding} onClose={() => setAdding(false)} />
      )}
      {limit !== null ? (
        <p className="mb-3 text-[13px] text-muted" data-testid="client-usage">
          {plan.data?.usage.clients} of {limit} clients on your plan. Archived clients don't count.
        </p>
      ) : null}
      <Card>
        {shown.length === 0 ? (
          showArchived ? (
            <EmptyState title="No archived clients" body="Archive clients you no longer work with. Their projects and records are kept." />
          ) : (
            <EmptyState title="No clients yet" body="Add a client here, or they're added automatically when you create a project for them." />
          )
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_150px_200px] gap-4 border-b border-line bg-canvas/60 px-5 py-2.5 text-[12px] font-medium text-muted md:grid">
              <span>Client</span>
              <span>Projects</span>
              <span className="text-right">{OUTSTANDING_LABEL.contract}</span>
            </div>
            <ul className="divide-y divide-line" data-testid="clients-list">
              {shown.map((c) => {
                const open = c.projects.filter((p) => OPEN.includes(p.status)).length;
                const totals = money(c.projects).filter((t) => t.outstanding);
                return (
                  <li key={c.id}>
                    <Link to={`/clients/${c.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-canvas md:grid-cols-[minmax(0,1fr)_150px_200px]">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-[12px] font-semibold text-ink-2" aria-hidden>
                          {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-medium text-ink">{c.name}</span>
                          <span className="block truncate text-[13px] text-muted">{c.company || c.email}</span>
                        </span>
                      </span>
                      <span className="text-[13px] text-ink-2">
                        {c.projects.length} project{c.projects.length === 1 ? "" : "s"}
                        {open ? <span className="text-muted">, {open} open</span> : null}
                      </span>
                      <span className="num col-span-2 text-[13px] md:col-span-1 md:text-right">
                        {totals.length ? (
                          totals.map((t) => (
                            <span key={t.currency} className="block font-medium text-ink">
                              {formatMoney(t.outstanding, t.currency)}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted">Nothing owed</span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
      {archived.length || showArchived ? (
        <button type="button" className="mt-3 text-[13px] font-medium text-accent hover:underline" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "← Back to clients" : `Archived clients (${archived.length})`}
        </button>
      ) : null}
    </>
  );
}

export function ClientPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ["client", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select(
          "id, name, email, company, phone, notes, billing_address, gstin, state_code, archived_at, created_at, projects(id, title, status, currency, budget_cents, approved_extras_cents, created_at, approved_at, milestones(title, amount_cents, status, paid_at, payment_note, paid_cents), scope_decisions(decision, client_name, created_at), change_orders(number, title, status, amount_cents, decided_at), client_invoices(id, number, issue_date, due_date, amount_cents, voided_at, milestones(status, paid_cents)), payments(id, amount_cents, paid_on, method, reference))",
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ClientRow | null;
    },
  });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError) return <Alert>Couldn't load this client. Please refresh.</Alert>;
  const c = q.data;
  if (!c) return <Alert>Client not found.</Alert>;

  const totals = money(c.projects);
  const history = c.projects
    .flatMap((p) => [
      ...(p.scope_decisions ?? []).map((d) => ({ at: d.created_at, project: p, text: `Scope ${d.decision === "approved" ? "approved" : "returned with changes"} by ${d.client_name}`, tone: d.decision === "approved" ? ("positive" as const) : ("danger" as const) })),
      ...(p.change_orders ?? [])
        .filter((o) => o.decided_at && (o.status === "approved" || o.status === "rejected"))
        .map((o) => ({ at: o.decided_at!, project: p, text: `Change order #${o.number} (${formatMoney(Number(o.amount_cents), p.currency)}) ${o.status}`, tone: o.status === "approved" ? ("positive" as const) : ("neutral" as const) })),
    ])
    .sort((a, b) => b.at.localeCompare(a.at));
  const payments = c.projects
    .flatMap((p) => (p.payments ?? []).map((x) => ({ ...x, project: p })))
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  const invoices = c.projects
    .flatMap((p) => (p.client_invoices ?? []).filter((i) => !i.voided_at).map((i) => ({ ...i, project: p })))
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.number.localeCompare(a.number));
  const today = localToday();
  const quotes = c.projects.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const approvedProjects = c.projects.filter((p) => p.approved_at && p.status !== "cancelled");
  const repeat = approvedProjects.length >= 2;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await action.run(clientSchema, Object.fromEntries(new FormData(e.currentTarget)), (v) =>
      supabase
        .rpc("update_client", { p_client_id: c!.id, p: v })
        .then((r) =>
          r.error ? r : supabase.rpc("update_client_billing", { p_client_id: c!.id, p: { billing_address: v.billing_address, gstin: v.gstin, state_code: v.state_code } }),
        ),
    );
    if (ok === undefined) return;
    await Promise.all([qc.invalidateQueries({ queryKey: ["client", id] }), qc.invalidateQueries({ queryKey: ["clients"] })]);
    setEditing(false);
    toast("positive", "Client saved.");
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/clients" className="hover:text-ink">
            ← Clients
          </Link>
        }
        title={c.name}
        description={[c.company, c.email].filter(Boolean).join(" · ")}
        actions={<LinkButton to={`/projects/new?client=${c.id}`}>New project for {c.name.split(" ")[0]}</LinkButton>}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Projects" />
            <ul className="divide-y divide-line">
              {c.projects
                .slice()
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((p) => (
                  <li key={p.id}>
                    <Link to={`/projects/${p.id}`} {...intentProps(qc, `/projects/${p.id}`)} className="flex items-center gap-4 px-5 py-3.5 hover:bg-sunken/60">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                      <span className="num hidden text-[13px] text-ink-2 sm:block">{formatMoney(Number(p.budget_cents) + Number(p.approved_extras_cents), p.currency)}</span>
                      <StatusBadge status={p.status} />
                    </Link>
                  </li>
                ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Approval history" />
            {history.length ? (
              <ul className="divide-y divide-line">
                {history.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[13px]">
                    <span>
                      {h.text} · <Link to={`/projects/${h.project.id}`} className="text-muted hover:text-ink">{h.project.title}</Link>
                    </span>
                    <span className="text-[12px] text-muted">{formatDateTime(h.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-5 text-[13px] text-muted">No decisions yet.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Invoices" />
            {invoices.length ? (
              <ul className="divide-y divide-line" data-testid="client-invoices">
                {invoices.map((i) => {
                  const s = invoiceStatus(i, i.milestones?.status === "paid", today, Number(i.milestones?.paid_cents ?? 0));
                  return (
                    <li key={i.id}>
                      <Link to={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px] hover:bg-sunken/60">
                        <span className="min-w-0">
                          <span className="num font-medium">{i.number}</span>
                          <span className="block truncate text-[12px] text-muted">
                            {i.project.title} · {formatDate(i.issue_date)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="num">{formatMoney(Number(i.amount_cents), i.project.currency)}</span>
                          {s === "paid" ? <Tag tone="positive">Paid</Tag> : s === "overdue" ? <Tag tone="warning">Overdue</Tag> : s === "partial" ? <Tag tone="accent">Part paid</Tag> : <Tag>Due</Tag>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-5 text-[13px] text-muted">No invoices yet.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Quotes" description="Every project's quote, as sent or as drafted." />
            <ul className="divide-y divide-line" data-testid="client-quotes">
              {quotes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.title}</span>
                    <span className="text-[12px] text-muted">{formatDate(p.created_at)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="num">{formatMoney(Number(p.budget_cents), p.currency)}</span>
                    <Link to={`/projects/${p.id}/quote`} className="font-medium text-accent hover:underline">
                      Quote
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Payments received" />
            {payments.length ? (
              <ul className="divide-y divide-line">
                {payments.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[13px]">
                    <span>
                      <Link to={`/projects/${x.project.id}`} className="hover:underline">{x.project.title}</Link>
                      <span className="block text-[12px] text-muted">
                        {methodLabel(x.method)}
                        {x.reference ? ` · ${x.reference}` : ""}
                      </span>
                    </span>
                    <span className="num">
                      {formatMoney(Number(x.amount_cents), x.project.currency)} <span className="text-[12px] text-muted">· {formatDate(x.paid_on)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-5 text-[13px] text-muted">No payments recorded yet.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Totals" description="Approved work only" />
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-[13px]">
              <dt className="text-muted">Projects</dt>
              <dd className="text-right">{c.projects.length}{repeat ? <span className="ml-2"><Tag tone="positive">Repeat client</Tag></span> : null}</dd>
              <dt className="text-muted">Client since</dt>
              <dd className="text-right">{formatDate(c.created_at)}</dd>
            </dl>
            {totals.length ? (
              <dl className="num space-y-2 px-5 py-4 text-[13px]">
                {totals.map((t) => (
                  <div key={t.currency} className="space-y-1">
                    <div className="flex justify-between"><dt className="text-muted">Contracted</dt><dd>{formatMoney(t.contracted, t.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Received</dt><dd className="text-positive">{formatMoney(t.paid, t.currency)}</dd></div>
                    <div className="flex justify-between font-semibold"><dt>{OUTSTANDING_LABEL.contract}</dt><dd>{formatMoney(t.outstanding, t.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Average project</dt><dd>{formatMoney(Math.round(t.contracted / t.count), t.currency)}</dd></div>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-5 py-4 text-[13px] text-muted">Nothing approved yet.</p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Contact and notes"
              description="Notes are private — your client never sees them."
              action={
                editing ? null : (
                  <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                )
              }
            />
            {editing ? (
              <form onSubmit={save} className="space-y-4 px-5 py-4" noValidate>
                {action.error ? <Alert>{action.error}</Alert> : null}
                <Field label="Name" htmlFor="c-name" error={action.fieldErrors.name}>
                  <Input id="c-name" name="name" defaultValue={c.name} />
                </Field>
                <Field label="Company" htmlFor="c-company" error={action.fieldErrors.company}>
                  <Input id="c-company" name="company" defaultValue={c.company ?? ""} />
                </Field>
                <Field label="Phone" htmlFor="c-phone" error={action.fieldErrors.phone}>
                  <Input id="c-phone" name="phone" type="tel" defaultValue={c.phone ?? ""} />
                </Field>
                <Field label="Billing address (for invoices)" htmlFor="c-billing" error={action.fieldErrors.billing_address}>
                  <Textarea id="c-billing" name="billing_address" rows={3} defaultValue={c.billing_address ?? ""} maxLength={500} />
                </Field>
                <Field label="Client GSTIN (optional)" htmlFor="c-gstin" error={action.fieldErrors.gstin} hint="For business clients registered for GST.">
                  <Input id="c-gstin" name="gstin" defaultValue={c.gstin ?? ""} autoCapitalize="characters" spellCheck={false} />
                </Field>
                <Field label="State (for GST)" htmlFor="c-state" hint="Decides the place of supply on invoices. Filled from the GSTIN if empty.">
                  <Select id="c-state" name="state_code" defaultValue={c.state_code ?? ""}>
                    <option value="">Not set</option>
                    {GST_STATES_SORTED.map(([code, n]) => (
                      <option key={code} value={code}>
                        {n} ({code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Private notes" htmlFor="c-notes" error={action.fieldErrors.notes}>
                  <Textarea id="c-notes" name="notes" rows={5} defaultValue={c.notes ?? ""} maxLength={4000} />
                </Field>
                <div className="flex gap-2">
                  <SubmitButton pending={action.pending} pendingLabel="Saving…">Save</SubmitButton>
                  <button type="button" className="px-3 text-[13px] text-muted" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <dl className="space-y-2 px-5 py-4 text-[13px]">
                <div className="flex justify-between gap-3"><dt className="text-muted">Email</dt><dd className="break-all">{c.email}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Phone</dt><dd>{c.phone || "—"}</dd></div>
                {c.billing_address ? <div className="flex justify-between gap-3"><dt className="text-muted">Billing address</dt><dd className="whitespace-pre-line text-right">{c.billing_address}</dd></div> : null}
                {c.gstin ? <div className="flex justify-between gap-3"><dt className="text-muted">GSTIN</dt><dd className="num">{c.gstin}</dd></div> : null}
                {stateOf(c) ? <div className="flex justify-between gap-3"><dt className="text-muted">State</dt><dd>{stateName(stateOf(c))}</dd></div> : null}
                <div className="flex justify-between gap-3"><dt className="text-muted">Client since</dt><dd>{formatDate(c.created_at)}</dd></div>
                <div className="pt-2">
                  <dt className="text-muted">Private notes</dt>
                  <dd className="mt-1 whitespace-pre-line break-words text-ink-2">{c.notes || <Tag>None yet</Tag>}</dd>
                </div>
              </dl>
            )}
          </Card>
          <ManageClient client={c} />
        </div>
      </div>
    </>
  );
}

/** Archive (hide, keep every record, frees a plan slot) or delete a client added by mistake. */
function ManageClient({ client: c }: { client: ClientRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["client", c.id] }),
      qc.invalidateQueries({ queryKey: ["clients"] }),
      qc.invalidateQueries({ queryKey: ["my-plan"] }),
    ]);
  async function archive(on: boolean) {
    setError(null);
    const { error: e } = await supabase.rpc("archive_client", { p_client_id: c.id, p_archived: on });
    if (e) return setError(e.message);
    await refresh();
    toast("positive", on ? "Client archived." : "Client restored.");
  }
  async function remove() {
    setError(null);
    const { error: e } = await supabase.rpc("delete_client", { p_client_id: c.id });
    if (e) return setError(e.message);
    await Promise.all([qc.invalidateQueries({ queryKey: ["clients"] }), qc.invalidateQueries({ queryKey: ["my-plan"] })]);
    toast("positive", "Client deleted.");
    navigate("/clients");
  }
  const busy = c.projects.some((p) => ["awaiting_approval", "changes_requested", "active"].includes(p.status));
  return (
    <Card>
      <CardHeader
        title={c.archived_at ? "Archived client" : "Manage client"}
        description={
          c.archived_at
            ? `Archived on ${formatDate(c.archived_at)}. Hidden from your lists and doesn't count towards your plan.`
            : "Archive clients you no longer work with. Their projects, invoices and payments are kept."
        }
      />
      <div className="space-y-3 px-5 py-4" data-testid="manage-client">
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          {c.archived_at ? (
            <ActionButton size="sm" variant="secondary" onAction={() => archive(false)} pendingLabel="Restoring…">
              Restore client
            </ActionButton>
          ) : (
            <ActionButton
              size="sm"
              variant="secondary"
              disabled={busy}
              onAction={() => archive(true)}
              confirm={`Archive ${c.name}? Their records stay, and you can restore them any time.`}
              confirmLabel="Archive client"
              pendingLabel="Archiving…"
            >
              Archive client
            </ActionButton>
          )}
          {c.projects.length === 0 ? (
            <ActionButton
              size="sm"
              variant="danger"
              onAction={remove}
              confirm={`Delete ${c.name}? This can't be undone.`}
              confirmLabel="Delete client"
              pendingLabel="Deleting…"
            >
              Delete client
            </ActionButton>
          ) : null}
        </div>
        {busy && !c.archived_at ? <p className="text-[12px] text-muted">Complete or cancel the open project before archiving.</p> : null}
        {c.projects.length ? <p className="text-[12px] text-muted">Clients with projects can be archived, not deleted, so your records stay complete.</p> : null}
      </div>
    </Card>
  );
}

const newClientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(120),
  email: z.email("Enter a valid email").max(254),
  company: z.string().trim().max(120),
  phone: z.string().trim().max(40).refine((v) => v === "" || /^[+()\d\s.-]{5,40}$/.test(v), "Use digits, spaces and + ( ) - only"),
});

/** Add a client without starting a project. Plan limits apply (checked by the database). */
function AddClient({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const action = useAction();
  if (!open) return null;
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = await action.run(newClientSchema, Object.fromEntries(new FormData(e.currentTarget)), (v) => supabase.rpc("create_client", { p: v }));
    if (id === undefined) return;
    await qc.invalidateQueries({ queryKey: ["clients"] });
    toast("positive", "Client added.");
    navigate(`/clients/${id as string}`);
  }
  return (
    <Card className="mb-6">
      <CardHeader title="New client" description="Name and email are enough. You can add billing details later." />
      <form onSubmit={onSubmit} className="space-y-4 p-5" noValidate data-testid="add-client">
        {action.error ? <Alert>{action.error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="nc-name" error={action.fieldErrors.name}>
            <Input id="nc-name" name="name" autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="nc-email" error={action.fieldErrors.email}>
            <Input id="nc-email" name="email" type="email" autoComplete="off" />
          </Field>
          <Field label="Company (optional)" htmlFor="nc-company" error={action.fieldErrors.company}>
            <Input id="nc-company" name="company" />
          </Field>
          <Field label="Phone (optional)" htmlFor="nc-phone" error={action.fieldErrors.phone}>
            <Input id="nc-phone" name="phone" type="tel" />
          </Field>
        </div>
        <div className="flex gap-2">
          <SubmitButton pending={action.pending} pendingLabel="Adding…">Add client</SubmitButton>
          <button type="button" className={buttonClass("ghost")} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
