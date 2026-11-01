/** Requests received outside ScopeFlow (logged by the freelancer) and adding clients directly. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261109000000_outside_requests_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };
const today = new Date().toISOString().slice(0, 10);

async function rpc<T = Json>(role: Role, fn: string, args: unknown[], on: PGlite = db): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(on, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
async function approved(revisions = 1) {
  const id = await rpc<string>(owner, "save_project", [null, JSON.stringify({
    title: `Out ${Math.random().toString(36).slice(2, 7)}`, currency: "INR", budget_cents: 1000,
    client: { name: "Dana", email: "dana@example.com" },
    deliverables: [{ title: "Logo", revisions_included: revisions }], milestones: [],
  })]);
  const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
  const view = await rpc<Json>(anon, "portal_view", [token]);
  await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null]);
  const [{ id: logo }] = await as<{ id: string }>(db, owner, "select id from deliverables where project_id = $1", [id]);
  return { id, token, logo };
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "out@example.com", "Priya");
  other = await createUser(db, "out-other@example.com", "Other");
});

describe("logging requests received outside ScopeFlow", () => {
  it("counts against the same limits as client-link requests, records where it came from, and shows the client", async () => {
    const p = await approved(1);
    const first = await rpc<Json>(owner, "log_client_request", [p.id, JSON.stringify({ kind: "revision", deliverable_id: p.logo, description: "Bolder wordmark", source: "whatsapp", received_on: today })]);
    expect(first).toMatchObject({ in_scope: true, revision_number: 1 });
    // The next one, from the client link, is now beyond the single included round.
    const second = await rpc<Json>(anon, "portal_request_revision", [p.token, "revision", p.logo, "Another tweak", "Dana", null]);
    expect(second).toMatchObject({ in_scope: false });
    const extra = await rpc<Json>(owner, "log_client_request", [p.id, JSON.stringify({ kind: "new_work", description: "Business cards too", source: "call" })]);
    expect(extra).toMatchObject({ in_scope: false });
    const rows = await as<Json>(db, owner, "select kind, in_scope, source, requested_by from revision_requests where project_id = $1 order by created_at", [p.id]);
    expect(rows).toEqual([
      { kind: "revision", in_scope: true, source: "whatsapp", requested_by: "Dana" },
      { kind: "revision", in_scope: false, source: "portal", requested_by: "Dana" },
      { kind: "new_work", in_scope: false, source: "call", requested_by: "Dana" },
    ]);
    const log = await as<{ summary: string; actor: string }>(db, owner, "select summary, actor from activity_log where project_id = $1 and event = 'revision.logged' order by created_at", [p.id]);
    expect(log[0]).toEqual({ actor: "freelancer", summary: 'Revision 1 of 1 for "Logo" (by WhatsApp, logged by you)' });
    const view = await rpc<Json>(anon, "portal_view", [p.token]);
    expect((view.revision_requests as Json[]).map((r) => r.source).sort()).toEqual(["call", "portal", "whatsapp"]);
  });

  it("ignores a double tap and refuses bad input, other accounts and closed projects", async () => {
    const p = await approved(2);
    const req = randomUUID();
    const body = JSON.stringify({ kind: "revision", deliverable_id: p.logo, description: "Same", source: "email", client_request_id: req });
    await rpc(owner, "log_client_request", [p.id, body]);
    expect(await rpc<Json>(owner, "log_client_request", [p.id, body])).toMatchObject({ duplicate: true });
    expect((await as<Json>(db, owner, "select count(*)::int n from revision_requests where project_id = $1", [p.id]))[0].n).toBe(1);
    await expect(rpc(owner, "log_client_request", [p.id, JSON.stringify({ kind: "revision", deliverable_id: p.logo, description: " ", source: "call" })])).rejects.toThrow(/Describe what the client asked/);
    await expect(rpc(owner, "log_client_request", [p.id, JSON.stringify({ kind: "revision", deliverable_id: p.logo, description: "x", source: "portal" })])).rejects.toThrow(/how the request arrived/);
    await expect(rpc(owner, "log_client_request", [p.id, JSON.stringify({ kind: "revision", deliverable_id: p.logo, description: "x", source: "call", received_on: "2999-01-01" })])).rejects.toThrow(/between the scope approval and today/);
    await expect(rpc(owner, "log_client_request", [p.id, JSON.stringify({ kind: "revision", description: "x", source: "call" })])).rejects.toThrow(/Choose a deliverable/);
    await expect(rpc(other, "log_client_request", [p.id, JSON.stringify({ kind: "new_work", description: "x", source: "call" })])).rejects.toThrow();
    await expect(rpc(anon, "log_client_request", [p.id, "{}"])).rejects.toThrow(/permission denied/);
    const draft = await rpc<string>(owner, "save_project", [null, JSON.stringify({
      title: "Draft", currency: "INR", budget_cents: 100, client: { name: "D", email: "d@example.com" },
      deliverables: [{ title: "X", revisions_included: 1 }], milestones: [],
    })]);
    await expect(rpc(owner, "log_client_request", [draft, JSON.stringify({ kind: "new_work", description: "x", source: "call" })])).rejects.toThrow(/while the project is in progress/);
  });
});

describe("adding clients directly", () => {
  it("creates a client, refuses duplicates and bad input, and respects plan limits", async () => {
    const id = await rpc<string>(owner, "create_client", [JSON.stringify({ name: "Ravi Kumar", email: "Ravi@Example.com", company: "Nova", phone: "+91 98765 43210" })]);
    expect((await as<Json>(db, owner, "select name, email, company, phone from clients where id = $1", [id]))[0]).toEqual({ name: "Ravi Kumar", email: "ravi@example.com", company: "Nova", phone: "+91 98765 43210" });
    await expect(rpc(owner, "create_client", [JSON.stringify({ name: "Ravi", email: "ravi@example.com" })])).rejects.toThrow(/already have a client/);
    await expect(rpc(owner, "create_client", [JSON.stringify({ name: "", email: "x@example.com" })])).rejects.toThrow(/name is required/);
    await expect(rpc(owner, "create_client", [JSON.stringify({ name: "X", email: "nope" })])).rejects.toThrow(/valid email/);
    await expect(rpc(anon, "create_client", ["{}"])).rejects.toThrow(/permission denied/);
    // Free plan: 5 clients.
    const free = await createUser(db, "free-clients@example.com", "Free", { plan: "free" });
    for (let i = 0; i < 5; i++) await rpc(free, "create_client", [JSON.stringify({ name: `C${i}`, email: `c${i}@example.com` })]);
    await expect(rpc(free, "create_client", [JSON.stringify({ name: "C6", email: "c6@example.com" })])).rejects.toThrow(/plan includes 5 clients/);
  });
});

describe("migration", () => {
  it("re-runs and rolls back (twice), restoring the previous client page", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration("20261109000000_outside_requests.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select count(*)::int n from information_schema.columns where table_name = 'revision_requests' and column_name = 'source'")).rows[0].n).toBe(0);
    expect((await fresh.query<Json>("select pg_get_functiondef('public.portal_view(text)'::regprocedure) like '%paid_cents%' as has")).rows[0].has).toBe(true);
    await fresh.exec(readMigration("20261109000000_outside_requests.sql"));
    expect((await fresh.query<Json>("select to_regproc('public.log_client_request') is not null as ok")).rows[0].ok).toBe(true);
  });
});
