import { useState, type FormEvent } from "react";
import { methodLabel } from "@/lib/payments";
import { invoiceStatus } from "@/lib/invoice";
import { localToday } from "@/lib/upcoming";
import { received } from "@/lib/pricing";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, LinkButton, PageHeader, StatusBadge, Tag, Textarea, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { PageSpinner } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { supabase } from "@/lib/supabase";
import { useAction } from "@/lib/use-action";
import { clientSchema } from "@/lib/validation";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
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
  return [...by.entries()].map(([currency, t]) => ({ currency, ...t, outstanding: t.contracted - t.paid }));
}

export function ClientsPage() {
  const q = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email, company, phone, notes, billing_address, gstin, created_at, projects(id, title, status, currency, budget_cents, approved_extras_cents, created_at, milestones(title, amount_cents, status, paid_at, payment_note, paid_cents))")
        .order("name");
      if (error) throw error;
      return data as unknown as ClientRow[];
    },
  });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load your clients. Please refresh.</Alert>;

  return (
    <>
      <PageHeader title="Clients" description="Everyone you work with, with their projects, approvals, invoices and payments." />
      <div className="mb-4">
        <AddClient />
      </div>
      <Card>
        {q.data.length === 0 ? (
          <EmptyState title="No clients yet" body="Add a client here, or they're added automatically when you create a project for them." />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((c) => {
              const open = c.projects.filter((p) => OPEN.includes(p.status)).length;
              const totals = money(c.projects);
              return (
                <li key={c.id}>
                  <Link to={`/clients/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-sunken/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-[13px] text-muted">{[c.company, c.email].filter(Boolean).join(" · ")}</p>
                    </div>
                    <p className="text-[13px] text-ink-2">
                      {c.projects.length} project{c.projects.length === 1 ? "" : "s"}
                      {open ? ` · ${open} open` : ""}
                    </p>
                    <p className="num w-full text-[13px] text-muted sm:w-auto sm:text-right">
                      {totals.length ? totals.map((t) => `${formatMoney(t.outstanding, t.currency)} outstanding`).join(" · ") : "—"}
                    </p>
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
          "id, name, email, company, phone, notes, billing_address, gstin, created_at, projects(id, title, status, currency, budget_cents, approved_extras_cents, created_at, approved_at, milestones(title, amount_cents, status, paid_at, payment_note, paid_cents), scope_decisions(decision, client_name, created_at), change_orders(number, title, status, amount_cents, decided_at), client_invoices(id, number, issue_date, due_date, amount_cents, voided_at, milestones(status, paid_cents)), payments(id, amount_cents, paid_on, method, reference))",
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
          r.error ? r : supabase.rpc("update_client_billing", { p_client_id: c!.id, p: { billing_address: v.billing_address, gstin: v.gstin } }),
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
                    <Link to={`/projects/${p.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-sunken/60">
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
                    <div className="flex justify-between font-semibold"><dt>Outstanding</dt><dd>{formatMoney(t.outstanding, t.currency)}</dd></div>
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
                <div className="flex justify-between gap-3"><dt className="text-muted">Client since</dt><dd>{formatDate(c.created_at)}</dd></div>
                <div className="pt-2">
                  <dt className="text-muted">Private notes</dt>
                  <dd className="mt-1 whitespace-pre-line break-words text-ink-2">{c.notes || <Tag>None yet</Tag>}</dd>
                </div>
              </dl>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

const newClientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(120),
  email: z.email("Enter a valid email").max(254),
  company: z.string().trim().max(120),
  phone: z.string().trim().max(40).refine((v) => v === "" || /^[+()\d\s.-]{5,40}$/.test(v), "Use digits, spaces and + ( ) - only"),
});

/** Add a client without starting a project. Plan limits apply (checked by the database). */
function AddClient() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const action = useAction();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Add client
      </Button>
    );
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = await action.run(newClientSchema, Object.fromEntries(new FormData(e.currentTarget)), (v) => supabase.rpc("create_client", { p: v }));
    if (id === undefined) return;
    await qc.invalidateQueries({ queryKey: ["clients"] });
    toast("positive", "Client added.");
    navigate(`/clients/${id as string}`);
  }
  return (
    <Card>
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
          <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
