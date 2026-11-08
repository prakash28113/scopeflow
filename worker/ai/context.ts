/**
 * Context retrieval. Every read uses the signed-in freelancer's own access token against the
 * database API, so Row Level Security decides what the AI may see: one account's projects never
 * reach another account's prompt, and a project id the user doesn't own simply returns nothing.
 * The database stays the source of truth; the model only ever sees a compact, read-only summary.
 */

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type SupaEnv = { SUPABASE_URL: string; SUPABASE_ANON_KEY: string };

export class ContextError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function supa(env: SupaEnv, token: string, f: Fetcher) {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const headers = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    async get<T>(path: string): Promise<T> {
      const res = await f(`${base}/rest/v1/${path}`, { headers });
      if (!res.ok) throw new ContextError(`read failed (${res.status})`, res.status === 401 ? 401 : 502);
      return (await res.json()) as T;
    },
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const res = await f(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
      const body = (await res.json().catch(() => null)) as T & { message?: string; code?: string };
      if (!res.ok) throw new ContextError(body?.message ?? `call failed (${res.status})`, res.status === 401 ? 401 : res.status);
      return body;
    },
    async user(): Promise<{ id: string; email: string | null } | null> {
      const res = await f(`${base}/auth/v1/user`, { headers });
      if (!res.ok) return null;
      const u = (await res.json().catch(() => null)) as { id?: string; email?: string } | null;
      return u?.id ? { id: u.id, email: u.email ?? null } : null;
    },
  };
}
export type Supa = ReturnType<typeof supa>;

const rupees = (cents: number | null | undefined) => (typeof cents === "number" ? Math.round(cents) / 100 : null);
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

type Row = Record<string, unknown>;

/** Everything about one project the AI may need, or null if the user can't see it. */
export async function projectContext(db: Supa, projectId: string) {
  const id = encodeURIComponent(projectId);
  const [projects, deliverables, requests, orders, milestones, payments, snapshots] = await Promise.all([
    db.get<Row[]>(`projects?id=eq.${id}&select=id,title,summary,status,currency,budget_cents,approved_extras_cents,start_date,due_date,extra_days,exclusions,terms,extra_revision_cents,approved_at,client:clients(name,company)`),
    db.get<Row[]>(`deliverables?project_id=eq.${id}&select=id,title,description,revisions_included,progress,due_date,pricing_type,amount_cents,rate_cents,hours,quantity,unit_label&order=position`),
    db.get<Row[]>(`revision_requests?project_id=eq.${id}&select=id,kind,description,deliverable_id,in_scope,revision_number,status,source,created_at&order=created_at.desc&limit=20`),
    db.get<Row[]>(`change_orders?project_id=eq.${id}&select=number,title,status,amount_cents,additional_days,created_at&order=number`),
    db.get<Row[]>(`milestones?project_id=eq.${id}&select=id,title,amount_cents,due_date,status&order=position`),
    db.get<Row[]>(`payments?project_id=eq.${id}&select=milestone_id,amount_cents,paid_on`),
    db.get<Row[]>(`scope_snapshots?project_id=eq.${id}&select=version,created_at,decisions:scope_decisions(decision,created_at)&order=version.desc&limit=3`),
  ]);
  const p = projects[0];
  if (!p) return null;
  const used = new Map<string, number>();
  for (const r of requests) if (r.kind === "revision" && typeof r.deliverable_id === "string") used.set(r.deliverable_id, (used.get(r.deliverable_id) ?? 0) + 1);
  const paidBy = new Map<string, number>();
  for (const pay of payments) paidBy.set(String(pay.milestone_id), (paidBy.get(String(pay.milestone_id)) ?? 0) + Number(pay.amount_cents));
  const client = (p.client ?? {}) as { name?: string; company?: string | null };
  const titleOf = new Map(deliverables.map((d) => [String(d.id), String(d.title)]));
  const latest = snapshots[0] as { version?: number; decisions?: { decision: string }[] } | undefined;
  return {
    id: String(p.id),
    title: String(p.title),
    status: String(p.status),
    client: { name: client.name ?? null, company: client.company ?? null },
    currency: String(p.currency),
    budget: rupees(p.budget_cents as number),
    approvedExtras: rupees(p.approved_extras_cents as number),
    extraRevisionPrice: rupees(p.extra_revision_cents as number | null),
    startDate: (p.start_date as string | null) ?? null,
    dueDate: (p.due_date as string | null) ?? null,
    extraDays: Number(p.extra_days ?? 0),
    summary: clip(p.summary as string | null, 800),
    exclusions: clip(p.exclusions as string | null, 800),
    terms: clip(p.terms as string | null, 800),
    approved: Boolean(p.approved_at),
    latestVersion: latest?.version ?? null,
    latestDecision: latest?.decisions?.[0]?.decision ?? null,
    deliverables: deliverables.map((d) => ({
      title: String(d.title),
      description: clip(d.description as string | null, 300),
      revisionsIncluded: Number(d.revisions_included ?? 0),
      revisionsUsed: used.get(String(d.id)) ?? 0,
      progress: (d.progress as string | null) ?? null,
      dueDate: (d.due_date as string | null) ?? null,
      pricing: d.pricing_type ? { type: String(d.pricing_type), amount: rupees(d.amount_cents as number | null), rate: rupees(d.rate_cents as number | null), hours: d.hours ?? null, quantity: d.quantity ?? null, unit: d.unit_label ?? null } : null,
    })),
    requests: requests.map((r) => ({
      kind: String(r.kind),
      text: clip(String(r.description ?? ""), 300),
      deliverable: typeof r.deliverable_id === "string" ? (titleOf.get(r.deliverable_id) ?? null) : null,
      inScope: Boolean(r.in_scope),
      status: String(r.status),
      source: (r.source as string | null) ?? null,
      on: String(r.created_at).slice(0, 10),
    })),
    changeOrders: orders.map((o) => ({ number: Number(o.number), title: String(o.title), status: String(o.status), amount: rupees(o.amount_cents as number), extraDays: Number(o.additional_days ?? 0) })),
    milestones: milestones.map((m) => ({ title: String(m.title), amount: rupees(m.amount_cents as number), paid: rupees(paidBy.get(String(m.id)) ?? 0), dueDate: (m.due_date as string | null) ?? null, status: String(m.status) })),
  };
}
export type ProjectContext = NonNullable<Awaited<ReturnType<typeof projectContext>>>;

/** A compact overview of the whole workspace for questions like "what's waiting on me?". */
export async function workspaceContext(db: Supa) {
  const [projects, openRequests, sentOrders, milestones, payments, invoices] = await Promise.all([
    db.get<Row[]>(`projects?status=neq.cancelled&select=id,title,status,currency,budget_cents,approved_extras_cents,due_date,updated_at,client:clients(name)&order=updated_at.desc&limit=40`),
    db.get<Row[]>(`revision_requests?status=eq.open&select=project_id,kind,description,in_scope,created_at&order=created_at.desc&limit=30`),
    db.get<Row[]>(`change_orders?status=eq.sent&select=project_id,number,title,amount_cents,created_at&limit=30`),
    db.get<Row[]>(`milestones?status=eq.pending&select=id,project_id,title,amount_cents,due_date&order=due_date.asc.nullslast&limit=60`),
    db.get<Row[]>(`payments?select=milestone_id,amount_cents&limit=500`),
    db.get<Row[]>(`client_invoices?voided_at=is.null&select=project_id,number,issue_date,due_date,amount_cents&order=issue_date.desc&limit=20`),
  ]);
  const paidBy = new Map<string, number>();
  for (const pay of payments) paidBy.set(String(pay.milestone_id), (paidBy.get(String(pay.milestone_id)) ?? 0) + Number(pay.amount_cents));
  const titleOf = new Map(projects.map((p) => [String(p.id), String(p.title)]));
  return {
    projects: projects.map((p) => ({
      id: String(p.id),
      title: String(p.title),
      client: ((p.client ?? {}) as { name?: string }).name ?? null,
      status: String(p.status),
      total: rupees(Number(p.budget_cents ?? 0) + Number(p.approved_extras_cents ?? 0)),
      currency: String(p.currency),
      dueDate: (p.due_date as string | null) ?? null,
    })),
    waitingForClient: projects.filter((p) => p.status === "awaiting_approval").map((p) => ({ projectId: String(p.id), project: String(p.title) })),
    changeOrdersAwaitingClient: sentOrders.map((o) => ({ projectId: String(o.project_id), project: titleOf.get(String(o.project_id)) ?? null, number: Number(o.number), title: String(o.title), amount: rupees(o.amount_cents as number) })),
    openClientRequests: openRequests.map((r) => ({ projectId: String(r.project_id), project: titleOf.get(String(r.project_id)) ?? null, kind: String(r.kind), outsideScope: !r.in_scope, text: clip(String(r.description ?? ""), 200), on: String(r.created_at).slice(0, 10) })),
    paymentsDue: milestones
      .map((m) => ({ projectId: String(m.project_id), project: titleOf.get(String(m.project_id)) ?? null, title: String(m.title), outstanding: rupees(Number(m.amount_cents) - (paidBy.get(String(m.id)) ?? 0)), dueDate: (m.due_date as string | null) ?? null }))
      .filter((m) => (m.outstanding ?? 0) > 0),
    recentInvoices: invoices.map((i) => ({ projectId: String(i.project_id), project: titleOf.get(String(i.project_id)) ?? null, number: String(i.number), issued: String(i.issue_date), due: (i.due_date as string | null) ?? null, amount: rupees(i.amount_cents as number) })),
  };
}
export type WorkspaceContext = Awaited<ReturnType<typeof workspaceContext>>;
