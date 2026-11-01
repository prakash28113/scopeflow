import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, CardHeader, EmptyState, Field, Input, PageHeader, StatusBadge, Tag, Textarea } from "@/components/ui";
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
};
type ClientRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  projects: ClientProject[];
};

const OPEN: ProjectStatus[] = ["draft", "awaiting_approval", "changes_requested", "active"];

/** Contracted, paid and outstanding per currency (approved work only). */
function money(projects: ClientProject[]) {
  const by = new Map<string, { contracted: number; paid: number }>();
  for (const p of projects) {
    if (p.status !== "active" && p.status !== "completed") continue;
    const t = by.get(p.currency) ?? { contracted: 0, paid: 0 };
    t.contracted += Number(p.budget_cents) + Number(p.approved_extras_cents);
    t.paid += p.milestones.filter((m) => m.status === "paid").reduce((s, m) => s + Number(m.amount_cents), 0);
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
        .select("id, name, email, company, phone, notes, created_at, projects(id, title, status, currency, budget_cents, approved_extras_cents, created_at, milestones(title, amount_cents, status, paid_at, payment_note))")
        .order("name");
      if (error) throw error;
      return data as unknown as ClientRow[];
    },
  });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <Alert>Couldn't load your clients. Please refresh.</Alert>;

  return (
    <>
      <PageHeader title="Clients" description="Everyone you've sent a scope to, with their projects, approvals and payments." />
      <Card>
        {q.data.length === 0 ? (
          <EmptyState title="No clients yet" body="Clients are added when you create a project for them." />
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
          "id, name, email, company, phone, notes, created_at, projects(id, title, status, currency, budget_cents, approved_extras_cents, created_at, milestones(title, amount_cents, status, paid_at, payment_note), scope_decisions(decision, client_name, created_at), change_orders(number, title, status, amount_cents, decided_at))",
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
    .flatMap((p) => p.milestones.filter((m) => m.status === "paid" && m.paid_at).map((m) => ({ ...m, project: p })))
    .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await action.run(clientSchema, Object.fromEntries(new FormData(e.currentTarget)), (v) =>
      supabase.rpc("update_client", { p_client_id: c!.id, p: v }),
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
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
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
            <CardHeader title="Payments received" />
            {payments.length ? (
              <ul className="divide-y divide-line">
                {payments.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[13px]">
                    <span>
                      {m.title} · <span className="text-muted">{m.project.title}</span>
                      {m.payment_note ? <span className="block text-[12px] text-muted">{m.payment_note}</span> : null}
                    </span>
                    <span className="num">
                      {formatMoney(Number(m.amount_cents), m.project.currency)} <span className="text-[12px] text-muted">· {formatDate(m.paid_at)}</span>
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
            {totals.length ? (
              <dl className="num space-y-2 px-5 py-4 text-[13px]">
                {totals.map((t) => (
                  <div key={t.currency} className="space-y-1">
                    <div className="flex justify-between"><dt className="text-muted">Contracted</dt><dd>{formatMoney(t.contracted, t.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Received</dt><dd className="text-positive">{formatMoney(t.paid, t.currency)}</dd></div>
                    <div className="flex justify-between font-semibold"><dt>Outstanding</dt><dd>{formatMoney(t.outstanding, t.currency)}</dd></div>
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
