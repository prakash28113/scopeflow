/** Security audit against an isolated database built from every real migration. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, any>;
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };
let a: Awaited<ReturnType<typeof fixture>>;
let b: Awaited<ReturnType<typeof fixture>>;
const rpc = async <T = Json>(who: Role, name: string, args: unknown[] = []): Promise<T> =>
  (await as<{ r: T }>(db, who, `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;

async function fixture(who: Role & { id: string }, name: string) {
  const project = await rpc<string>(who, "save_project", [null, JSON.stringify({
    title: `Private ${name}`, currency: "INR", budget_cents: 10000,
    client: { name, email: `${name}@client.example` },
    deliverables: [{ title: `Private deliverable ${name}`, revisions_included: 2 }],
    milestones: [{ title: "Deposit", amount_cents: 10000 }],
  })]);
  const sent = await rpc(who, "send_scope", [project, 30]);
  const token = sent.link.token as string;
  const view = await rpc(anon, "portal_view", [token]);
  const snapshot = view.snapshot.id as string;
  await rpc(anon, "portal_decide_scope", [token, snapshot, "approved", name, null]);
  const one = async (table: string) => (await as<{ id: string }>(db, who, `select id from public.${table} where project_id = $1`, [project]))[0].id;
  const deliverable = await one("deliverables");
  const milestone = await one("milestones");
  await rpc(anon, "portal_request_revision", [token, "revision", deliverable, "Revision", name, randomUUID()]);
  const revision = await one("revision_requests");
  const change = await rpc<string>(who, "create_change_order", [project, JSON.stringify({ title: "Extra work", pricing_type: "fixed", amount_cents: 1000 })]);
  await rpc(anon, "portal_decide_change_order", [token, change, "approved", name, null]);
  const invoice = await rpc<string>(who, "create_invoice", [milestone, "{}"]);
  const payment = await rpc<string>(who, "record_payment", [milestone, JSON.stringify({ amount_cents: 100, method: "bank_transfer" })]);
  await rpc(who, "record_nudge", [invoice, JSON.stringify({ channel: "email", tone: "gentle" })]);
  const followUp = (await as<{ id: string }>(db, who, "select id from follow_ups where project_id = $1", [project]))[0].id;
  const expense = await rpc<string>(who, "add_expense", [JSON.stringify({ project_id: project, spent_on: "2026-01-01", amount_cents: 100, category: "other" })]);
  const template = await rpc<string>(who, "save_template", [name, JSON.stringify({ deliverables: [{ title: name }] })]);
  await rpc(who, "join_early_access", ["solo", "month"]);
  await rpc(who, "log_usage_event", ["checkout_open", "plan"]);
  await db.query("insert into public.invoices(owner_id,provider,provider_invoice_id,amount_cents,currency,status) values($1,'audit',$2,100,'INR','paid')", [who.id, randomUUID()]);
  const client = (await as<{ client_id: string }>(db, who, "select client_id from projects where id=$1", [project]))[0].client_id;
  return { project, token, snapshot, deliverable, milestone, revision, change, invoice, payment, followUp, expense, template, client };
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "audit-owner@example.com");
  other = await createUser(db, "audit-other@example.com");
  a = await fixture(owner, "alpha");
  b = await fixture(other, "bravo");
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("cross-account RLS and RPC isolation", () => {
  it("seeds and checks every private SELECT policy, including column-only grants", async () => {
    const { rows: tables } = await db.query<{ tablename: string }>("select distinct tablename from pg_policies where schemaname='public' and tablename not in ('plans','blog_posts') order by 1");
    expect(tables.length).toBeGreaterThan(20);
    for (const { tablename } of tables) {
      // Catalog names, not user-supplied SQL. Every reviewed policy must have actual victim rows.
      const key = ["subscriptions", "early_access_requests"].includes(tablename) ? "owner_id" : "id";
      const victims = await as<Record<string, string>>(db, owner, `select ${key} from public.${tablename}`);
      expect(victims.length, `${tablename} fixture coverage`).toBeGreaterThan(0);
      const ids = victims.map(row => row[key]);
      expect(await as(db, other, `select ${key} from public.${tablename} where ${key}=any($1::uuid[])`, [ids]), tablename).toEqual([]);
      await expect(as(db, anon, `select ${key} from public.${tablename}`), tablename).rejects.toThrow(/permission denied/);
    }
  });

  it("rejects foreign ids across freelancer mutation entry points", async () => {
    const today = (await db.query<{ today: string }>("select current_date::text as today")).rows[0].today;
    const attempts: [string, unknown[]][] = [
      ["update_client", [a.client, '{"name":"attacker"}']], ["update_client_billing", [a.client, "{}"]],
      ["archive_client", [a.client, true]], ["delete_client", [a.client]],
      ["delete_draft_project", [a.project]], ["rotate_share_link", [a.project, 30]], ["revoke_share_link", [a.project]],
      ["send_scope", [a.project, 30]], ["recall_scope", [a.project]], ["cancel_project", [a.project]], ["complete_project", [a.project]],
      ["set_deliverable_progress", [a.deliverable, "delivered"]], ["resolve_revision", [a.revision, "attacker"]],
      ["withdraw_change_order", [a.change]], ["complete_change_order_work", [a.change]],
      ["record_payment", [a.milestone, '{"amount_cents":1}']], ["delete_payment", [a.payment]],
      ["set_milestone_paid", [a.milestone, false, null]], ["create_invoice", [a.milestone, "{}"]],
      ["void_invoice", [a.invoice, "attacker"]], ["record_nudge", [a.invoice, '{"channel":"email","tone":"gentle"}']],
      ["delete_expense", [a.expense]], ["delete_template", [a.template]],
      ["set_follow_up_done", [a.followUp, true]], ["delete_follow_up", [a.followUp]],
      ["add_follow_up", [JSON.stringify({ project_id: a.project, due_on: today, note: "attacker" })]],
      ["add_expense", [JSON.stringify({ project_id: a.project, spent_on: "2026-01-01", amount_cents: 1 })]],
      ["add_payment", [a.project, '{"amount_cents":1}']],
      ["create_change_order", [a.project, '{"title":"Extra","pricing_type":"fixed","amount_cents":1}']],
      ["log_client_request", [a.project, '{"kind":"new_work","description":"attacker"}']],
    ];
    for (const [fn, args] of attempts) await expect(rpc(other, fn, args), fn).rejects.toThrow(/not found/i);
    expect((await as<{ title: string }>(db, owner, "select title from projects where id=$1", [a.project]))[0].title).toBe("Private alpha");
  });

  it("binds anonymous write identifiers to the project authorized by the token", async () => {
    await expect(rpc(anon, "portal_request_revision", [a.token, "revision", b.deliverable, "foreign", "Client", randomUUID()])).rejects.toThrow(/this project/);
    await expect(rpc(anon, "portal_decide_change_order", [a.token, b.change, "approved", "Client", null])).rejects.toThrow(/not found/);
    const view = await rpc(anon, "portal_view", [a.token]);
    expect(view.project.title).toBe("Private alpha");
    expect(JSON.stringify(view)).not.toContain("Private bravo");
    expect(JSON.stringify(view)).not.toContain("audit-other@example.com");
    expect(JSON.stringify(view)).not.toContain(b.token);
  });
});

describe("anonymous bearer-token gate", () => {
  const calls = (token: unknown): [string, unknown[]][] => [
    ["portal_view", [token]], ["portal_decide_scope", [token, a.snapshot, "approved", "Client", null]],
    ["portal_request_revision", [token, "revision", a.deliverable, "request", "Client", randomUUID()]],
    ["portal_decide_change_order", [token, a.change, "approved", "Client", null]],
  ];
  it("rejects malformed tokens through every public portal endpoint", async () => {
    for (const token of [null, "", "x".repeat(42), "x".repeat(44), "!".repeat(43), "../".repeat(15), "x".repeat(43)]) {
      for (const [fn, args] of calls(token)) expect((await rpc(anon, fn, args)).error, fn).toBe("invalid_link");
    }
  });
  it("rejects rotated, revoked and expired tokens through every endpoint", async () => {
    const first = await rpc(owner, "rotate_share_link", [a.project, 30]);
    for (const [fn, args] of calls(a.token)) expect((await rpc(anon, fn, args)).error).toBe("invalid_link");
    await rpc(owner, "revoke_share_link", [a.project]);
    for (const [fn, args] of calls(first.token)) expect((await rpc(anon, fn, args)).error).toBe("invalid_link");
    const expired = await rpc(owner, "rotate_share_link", [a.project, 30]);
    await db.query("update share_links set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where project_id=$1 and revoked_at is null", [a.project]);
    for (const [fn, args] of calls(expired.token)) expect((await rpc(anon, fn, args)).error).toBe("expired_link");
  });
  it("reapplies and rolls back the security migration without broadening grants", async () => {
    const file = "20261127000000_portal_revocation_gate.sql";
    const signature = "public._portal_gate(text, boolean, boolean)";
    const privileges = async () => (await db.query("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') u", [signature])).rows;
    expect(await privileges()).toEqual([{ a: false, u: false }]);
    await db.exec(readMigration(file));
    await db.exec(readMigration(file));
    await db.exec(readFileSync(new URL("../../supabase/rollback/20261127000000_portal_revocation_gate_down.sql", import.meta.url), "utf8"));
    expect(await privileges()).toEqual([{ a: false, u: false }]);
    await db.exec(readMigration(file));
    expect(await privileges()).toEqual([{ a: false, u: false }]);
  });
});
