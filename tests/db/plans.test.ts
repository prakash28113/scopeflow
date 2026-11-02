/**
 * Subscription plans, Phase 1: plan records, server-side limits, entitlements,
 * plan changes only from the back office, idempotent billing events.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, service, type Role } from "./harness";

type Json = Record<string, unknown>;
const PLANS = "20261102000000_subscription_plans.sql";
const DOWN = readFileSync(new URL("../../supabase/rollback/20261102000000_subscription_plans_down.sql", import.meta.url), "utf8");
let db: PGlite;

const project = (n: number, clientEmail = `client${n}@example.com`) => ({
  title: `Project ${n}`,
  currency: "INR",
  budget_cents: 100000,
  client: { name: `Client ${n}`, email: clientEmail },
  deliverables: [{ title: "Logo", revisions_included: 2 }],
  milestones: [],
});

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0].r;
}
const create = (u: Role, n: number, email?: string) => rpc<string>(u, "save_project", [null, JSON.stringify(project(n, email))]);
const setPlan = (email: string, plan: string, status: string, periodEnd: string | null = null) =>
  db.query("select public.admin_set_plan($1, $2, $3, $4, $5::timestamptz, 'test')", [email, plan, status, plan === "free" ? null : "month", periodEnd]);
const myPlan = (u: Role) => rpc<Json>(u, "my_plan", []);

beforeAll(async () => {
  db = await createDb();
});

describe("plan catalogue", () => {
  it("is public, read-only, and holds the agreed hypotheses", async () => {
    const rows = await as<Json>(db, anon, "select id, monthly_price_cents, annual_price_cents, max_active_projects, max_clients, max_team_members, purchasable from plans order by position");
    expect(rows).toEqual([
      { id: "free", monthly_price_cents: 0, annual_price_cents: 0, max_active_projects: 2, max_clients: 5, max_team_members: 1, purchasable: false },
      { id: "solo", monthly_price_cents: 49900, annual_price_cents: 499900, max_active_projects: null, max_clients: null, max_team_members: 1, purchasable: false },
      { id: "studio", monthly_price_cents: 99900, annual_price_cents: 999900, max_active_projects: null, max_clients: null, max_team_members: 3, purchasable: false },
    ]);
    const u = await createUser(db, "cat@example.com", "Cat", { plan: "free" });
    await expect(as(db, u, "update plans set max_active_projects = 99")).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, "insert into plans (id, name, position, monthly_price_cents, annual_price_cents) values ('solo','x',9,0,0)")).rejects.toThrow(/permission denied/);
  });
});

describe("Free plan limits (enforced in the database)", () => {
  it("allows 2 active projects, blocks the 3rd with a clear explanation, and keeps editing allowed", async () => {
    const u = await createUser(db, "free1@example.com", "Free", { plan: "free" });
    const p1 = await create(u, 1);
    await create(u, 2);
    const err = await create(u, 3).catch((e) => e);
    expect(err.code).toBe("SF402");
    expect(err.message).toMatch(/Free plan includes 2 active projects, and you have 2/);
    expect(err.hint).toBe("plan_limit:active_projects");
    expect(JSON.parse(err.detail)).toEqual({ limit: 2, used: 2, plan: "free" });
    // Editing an existing project at the limit is never blocked.
    await rpc(u, "save_project", [p1, JSON.stringify({ ...project(1), title: "Renamed" })]);
    expect((await myPlan(u)).usage).toEqual({ active_projects: 2, clients: 2 });
  });

  it("frees a slot when a project is completed or cancelled", async () => {
    const u = await createUser(db, "free2@example.com", "Free", { plan: "free" });
    const p1 = await create(u, 1);
    await create(u, 2);
    await rpc(u, "cancel_project", [p1]);
    await expect(create(u, 3)).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("allows 5 clients, blocks a 6th new client, but reusing an existing client is fine", async () => {
    const u = await createUser(db, "free3@example.com", "Free", { plan: "free" });
    for (let i = 1; i <= 5; i++) {
      const id = await create(u, i);
      await rpc(u, "cancel_project", [id]); // keep active projects below the project limit
    }
    const err = await create(u, 6).catch((e) => e);
    expect(err.code).toBe("SF402");
    expect(err.hint).toBe("plan_limit:clients");
    await expect(create(u, 7, "client3@example.com")).resolves.toMatch(/^[0-9a-f-]{36}$/);
    // Switching an existing draft to a brand-new client counts as adding a client.
    const draft = await create(u, 8, "client4@example.com");
    await expect(rpc(u, "save_project", [draft, JSON.stringify(project(8, "new@example.com"))])).rejects.toMatchObject({ code: "SF402" });
  });

  it("can't be bypassed by writing to tables directly", async () => {
    const u = await createUser(db, "free4@example.com", "Free", { plan: "free" });
    await expect(as(db, u, "insert into projects (owner_id, client_id, title, currency, budget_cents) values ($1, gen_random_uuid(), 'x', 'INR', 1)", [u.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, u, "insert into clients (owner_id, name, email) values ($1, 'x', 'x@example.com')", [u.id])).rejects.toThrow(/permission denied/);
  });
});

describe("paid plans", () => {
  it("Solo and Studio accounts have no project or client limits", async () => {
    for (const plan of ["solo", "studio"]) {
      const email = `${plan}@example.com`;
      const u = await createUser(db, email, plan, { plan: "free" });
      await setPlan(email, plan, "active", "2099-01-01T00:00:00Z");
      for (let i = 1; i <= 7; i++) await create(u, i);
      const p = await myPlan(u);
      expect(p).toMatchObject({ plan, status: "active", effective_plan: plan, limits: { active_projects: null, clients: null } });
      expect((p.usage as Json).active_projects).toBe(7);
    }
  });
});

describe("nobody can change their own plan", () => {
  it("subscriptions, the audit trail and billing tables are read-only to the app", async () => {
    const u = await createUser(db, "self@example.com", "Self", { plan: "free" });
    await expect(as(db, u, "update subscriptions set plan_id = 'studio', status = 'active'")).rejects.toThrow(/permission denied/);
    await expect(as(db, u, "insert into subscription_changes (owner_id, to_plan, to_status, source) values ($1, 'studio', 'active', 'admin')", [u.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, u, "insert into invoices (owner_id, provider, provider_invoice_id, amount_cents, currency, status) values ($1, 'x', 'y', 0, 'USD', 'paid')", [u.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, u, "select * from billing_events")).rejects.toThrow(/permission denied/);
    await expect(as(db, u, "select provider_customer_id from subscriptions")).rejects.toThrow(/permission denied/);
    await expect(rpc(u, "admin_set_plan", ["self@example.com", "studio", "active", null, null, null])).rejects.toThrow(/permission denied/);
    await expect(rpc(u, "process_billing_event", ["x", "evt", "subscription.activated", u.id, "studio", "year", "2099-01-01", "{}"])).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "my_plan", [])).rejects.toThrow(/permission denied/);
    expect(await myPlan(u)).toMatchObject({ plan: "free", status: "free", effective_plan: "free" });
  });

  it("each account sees only its own subscription", async () => {
    const a = await createUser(db, "seeA@example.com", "A", { plan: "free" });
    await createUser(db, "seeB@example.com", "B", { plan: "free" });
    const rows = await as<Json>(db, a, "select owner_id from subscriptions");
    expect(rows).toEqual([{ owner_id: a.id }]);
  });
});

describe("downgrades and lifecycle", () => {
  it("downgrading keeps every project, link and approval working; only new projects are blocked", async () => {
    const email = "down@example.com";
    const u = await createUser(db, email, "Down", { plan: "free" });
    await setPlan(email, "solo", "active", "2099-01-01T00:00:00Z");
    const ids = [];
    for (let i = 1; i <= 4; i++) ids.push(await create(u, i));
    const sent = await rpc<Json>(u, "send_scope", [ids[0], 30]);
    const token = (sent.link as Json).token as string;

    await setPlan(email, "free", "free");
    expect((await as(db, u, "select id from projects")).length).toBe(4);
    const v = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Client", null]);
    await rpc(u, "save_project", [ids[1], JSON.stringify({ ...project(2), title: "Still editable" })]);
    await expect(create(u, 5)).rejects.toMatchObject({ code: "SF402" });
    expect((await rpc<Json>(anon, "portal_view", [token])).project).toMatchObject({ status: "active" });
  });

  it("cancelled keeps paid limits until the period ends; past due has a grace period; expired is Free", async () => {
    const email = "life@example.com";
    const u = await createUser(db, email, "Life", { plan: "free" });
    const eff = async () => (await myPlan(u)).effective_plan;
    await setPlan(email, "solo", "cancelled", "2099-01-01T00:00:00Z");
    expect(await eff()).toBe("solo");
    await setPlan(email, "solo", "cancelled", "2020-01-01T00:00:00Z");
    expect(await eff()).toBe("free");
    await setPlan(email, "solo", "past_due", "2099-01-01T00:00:00Z"); // admin past_due → 7-day grace
    expect(await eff()).toBe("solo");
    await db.query("update subscriptions set grace_until = now() - interval '1 minute' where owner_id = $1", [u.id]);
    expect(await eff()).toBe("free");
    await setPlan(email, "solo", "expired");
    expect(await eff()).toBe("free");
    await setPlan(email, "solo", "active", "2020-01-01T00:00:00Z"); // period ended without renewal
    expect(await eff()).toBe("free");
  });

  it("every change is recorded in an append-only audit trail", async () => {
    const email = "audit@example.com";
    const u = await createUser(db, email, "Audit", { plan: "free" });
    await setPlan(email, "studio", "active", "2099-01-01T00:00:00Z");
    await setPlan(email, "free", "free");
    const rows = await as<Json>(db, u, "select from_plan, to_plan, to_status, source from subscription_changes order by created_at");
    expect(rows).toEqual([
      { from_plan: null, to_plan: "free", to_status: "free", source: "signup" },
      { from_plan: "free", to_plan: "studio", to_status: "active", source: "admin" },
      { from_plan: "studio", to_plan: "free", to_status: "free", source: "admin" },
    ]);
    await expect(db.query("update subscription_changes set to_plan = 'studio'")).rejects.toThrow(/immutable/);
    await expect(db.query("delete from subscription_changes")).rejects.toThrow(/immutable/);
  });
});

describe("billing events (future payment webhook)", () => {
  const evt = (owner: string, id: string, type: string, extra: unknown[] = [null, null, null]) =>
    as<{ r: boolean }>(db, service, "select public.process_billing_event($1, $2, $3, $4, $5, $6, $7::timestamptz, '{}'::jsonb) as r", ["testpay", id, type, owner, ...extra]).then((r) => r[0].r);

  it("a failed payment never grants paid access", async () => {
    const u = await createUser(db, "failpay@example.com", "F", { plan: "free" });
    expect(await evt(u.id, "evt_fail_1", "payment.failed")).toBe(true);
    expect(await myPlan(u)).toMatchObject({ status: "free", effective_plan: "free" });
  });

  it("only a confirmed activation grants the plan; a later failure gives a short grace, then Free", async () => {
    const u = await createUser(db, "paid@example.com", "P", { plan: "free" });
    await evt(u.id, "evt_act_1", "subscription.activated", ["solo", "year", "2099-01-01T00:00:00Z"]);
    expect(await myPlan(u)).toMatchObject({ plan: "solo", status: "active", effective_plan: "solo", billing_interval: "year" });
    await evt(u.id, "evt_fail_2", "payment.failed");
    const p = await myPlan(u);
    expect(p).toMatchObject({ status: "past_due", effective_plan: "solo" });
    expect(Date.parse(p.grace_until as string)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    await evt(u.id, "evt_exp_1", "subscription.expired");
    expect(await myPlan(u)).toMatchObject({ status: "expired", effective_plan: "free" });
  });

  it("duplicate deliveries of the same event are ignored", async () => {
    const u = await createUser(db, "dup@example.com", "D", { plan: "free" });
    expect(await evt(u.id, "evt_dup", "subscription.activated", ["studio", "month", "2099-01-01T00:00:00Z"])).toBe(true);
    expect(await evt(u.id, "evt_dup", "subscription.activated", ["studio", "month", "2099-01-01T00:00:00Z"])).toBe(false);
    const [{ n }] = (await db.query<Json>("select count(*)::int as n from billing_events where provider_event_id = 'evt_dup'")).rows;
    const [{ c }] = (await db.query<Json>("select count(*)::int as c from subscription_changes where owner_id = $1 and source = 'provider'", [u.id])).rows;
    expect([n, c]).toEqual([1, 1]);
  });

  it("rejects an activation without a paid plan, interval and period", async () => {
    const u = await createUser(db, "badact@example.com", "B", { plan: "free" });
    await expect(evt(u.id, "evt_bad", "subscription.activated", ["free", "month", "2099-01-01T00:00:00Z"])).rejects.toThrow(/paid plan/);
    expect((await myPlan(u)).effective_plan).toBe("free");
  });
});

describe("early access", () => {
  it("records interest in a paid plan without changing the plan", async () => {
    const u = await createUser(db, "early@example.com", "E", { plan: "free" });
    await rpc(u, "join_early_access", ["solo", "year"]);
    await rpc(u, "join_early_access", ["studio", "month"]);
    const p = await myPlan(u);
    expect(p).toMatchObject({ plan: "free", effective_plan: "free", early_access: { plan: "studio", billing_interval: "month" } });
    await expect(rpc(u, "join_early_access", ["free", "month"])).rejects.toThrow(/Solo or Studio/);
  });
});

describe("migration safety", () => {
  it("backfills Free for existing accounts, re-runs cleanly, and rolls back (twice) to unlimited v1.1", async () => {
    const fresh = await createDb({ upTo: "20261101000000_v1_1_agreement.sql" });
    const u = await createUser(fresh, "before@example.com", "Before");
    const saveAs = async (n: number) =>
      (await as<{ r: string }>(fresh, u, "select public.save_project(null, $1) as r", [JSON.stringify(project(n))]))[0].r;
    for (let i = 1; i <= 3; i++) await saveAs(i);

    await fresh.exec(readMigration(PLANS));
    await fresh.exec(readMigration(PLANS));
    const [s] = (await fresh.query<Json>("select plan_id, status from subscriptions where owner_id = $1", [u.id])).rows;
    expect(s).toEqual({ plan_id: "free", status: "free" });
    const [{ n }] = (await fresh.query<Json>("select count(*)::int as n from subscription_changes where owner_id = $1 and source = 'backfill'", [u.id])).rows;
    expect(n).toBe(1);
    // Existing over-limit account: keeps its 3 projects, can't add a 4th.
    expect((await as(fresh, u, "select id from projects")).length).toBe(3);
    await expect(saveAs(4)).rejects.toMatchObject({ code: "SF402" });

    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select to_regclass('public.subscriptions') as t")).rows[0].t).toBeNull();
    await expect(saveAs(4)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await fresh.exec(readMigration(PLANS));
    expect((await fresh.query<Json>("select count(*)::int as n from subscriptions")).rows[0].n).toBe(1);
  });
});
