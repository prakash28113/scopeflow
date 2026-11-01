/** Quotes: validity dates, quantity × unit price, and saved templates. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261111000000_quotes_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function rpc<T = Json>(role: Role, fn: string, args: unknown[], on: PGlite = db): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(on, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
const project = (extra: Json = {}) =>
  rpc<string>(owner, "save_project", [null, JSON.stringify({
    title: `Q ${Math.random().toString(36).slice(2, 7)}`, currency: "INR", budget_cents: 1000,
    client: { name: "Dana", email: "dana@example.com" },
    deliverables: [{ title: "Logo", revisions_included: 1 }], milestones: [], ...extra,
  })]);

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "quotes@example.com", "Priya");
  other = await createUser(db, "quotes-other@example.com", "Other");
});

describe("quantity × unit price", () => {
  it("prices lines per unit, mixed with fixed and hourly, and the database sets the total", async () => {
    const id = await project({
      discount_bps: 1000, tax_bps: 1800, tax_label: "GST",
      deliverables: [
        { title: "Instagram posts", revisions_included: 1, pricing_type: "unit", quantity: "10", rate_cents: 50000, unit_label: "posts" },
        { title: "Logo", revisions_included: 2, pricing_type: "fixed", amount_cents: 2500000 },
        { title: "Edits", revisions_included: 0, pricing_type: "hourly", hours: "1.5", rate_cents: 100000 },
        { title: "Reels", revisions_included: 1, pricing_type: "unit", quantity: "2.5", rate_cents: 333 },
      ],
    });
    const rows = await as<Json>(db, owner, "select pricing_type, quantity::text q, unit_label, rate_cents::int r, amount_cents::int a from deliverables where project_id = $1 order by position", [id]);
    expect(rows).toEqual([
      { pricing_type: "unit", q: "10.00", unit_label: "posts", r: 50000, a: 500000 },
      { pricing_type: "fixed", q: null, unit_label: null, r: null, a: 2500000 },
      { pricing_type: "hourly", q: null, unit_label: null, r: 100000, a: 150000 },
      { pricing_type: "unit", q: "2.50", unit_label: null, r: 333, a: 833 }, // 832.5 rounds half up
    ]);
    // Subtotal 3,150,833; −10% = 2,835,750 (discount 315,083); +18% = 510,435 → 3,346,185
    const [{ budget_cents }] = await as<{ budget_cents: string }>(db, owner, "select budget_cents::text from projects where id = $1", [id]);
    expect(budget_cents).toBe("3346185");
    const scope = (await db.query<{ s: Json }>("select public._build_scope($1) s", [id])).rows;
    expect((scope[0].s.deliverables as Json[])[0]).toMatchObject({ pricing_type: "unit", quantity: 10, unit_label: "posts", rate_cents: 50000 });
  });

  it("refuses incomplete per-unit lines", async () => {
    await expect(project({ deliverables: [{ title: "X", revisions_included: 1, pricing_type: "unit", rate_cents: 100 }] })).rejects.toThrow();
    await expect(project({ deliverables: [{ title: "X", revisions_included: 1, pricing_type: "unit", quantity: "0", rate_cents: 100 }] })).rejects.toThrow();
    await expect(db.query("update deliverables set unit_label = 'posts' where pricing_type = 'fixed'")).rejects.toThrow(/deliverables_pricing_complete/);
  });
});

describe("quote validity", () => {
  it("is part of what the client approves; a quote can be approved up to its last day", async () => {
    const id = await project({ valid_until: day(0) });
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    const view = await rpc<Json>(anon, "portal_view", [token]);
    expect(((view.snapshot as Json).data as Json).valid_until).toBe(day(0));
    expect(await rpc<Json>(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null])).toMatchObject({ ok: true });
  });

  it("an expired quote can't be approved, but the client can still ask for changes; a new date lets it through", async () => {
    const id = await project({ valid_until: day(3) });
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    // Time passes: simulate an expired quote in the sent version (snapshots are otherwise immutable).
    await db.exec("alter table public.scope_snapshots disable trigger user");
    await db.query("update scope_snapshots set data = jsonb_set(data, '{valid_until}', to_jsonb($2::text)) where project_id = $1", [id, day(-3)]);
    await db.exec("alter table public.scope_snapshots enable trigger user");
    let view = await rpc<Json>(anon, "portal_view", [token]);
    const snap = (view.snapshot as Json).id;
    await expect(rpc(anon, "portal_decide_scope", [token, snap, "approved", "Dana", null])).rejects.toThrow(/was valid until .* Ask for an updated quote/);
    expect(await rpc<Json>(anon, "portal_decide_scope", [token, snap, "rejected", "Dana", "Please extend the date"])).toMatchObject({ ok: true });
    // The freelancer can't save or send a date that has passed…
    const body = (until: string) => JSON.stringify({ title: "Renewed", currency: "INR", budget_cents: 1000, valid_until: until,
      client: { name: "Dana", email: "dana@example.com" }, deliverables: [{ title: "Logo", revisions_included: 1 }], milestones: [] });
    await expect(rpc(owner, "save_project", [id, body(day(-2))])).rejects.toThrow(/valid until" date has passed/);
    // …but a new date works, and the new version can be approved.
    await rpc(owner, "save_project", [id, body(day(7))]);
    await rpc(owner, "send_scope", [id, 30]);
    view = await rpc<Json>(anon, "portal_view", [token]);
    expect(await rpc<Json>(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null])).toMatchObject({ ok: true });
  });

  it("can't be sent once passed (a draft saved earlier)", async () => {
    const id = await project({ valid_until: day(1) });
    await db.query("update projects set valid_until = $2 where id = $1", [id, day(-5)]);
    await expect(rpc(owner, "send_scope", [id, 30])).rejects.toThrow(/has passed. Edit the scope/);
  });
});

describe("saved templates", () => {
  const data = (n = 1) => JSON.stringify({ summary: "Monthly social", deliverables: Array.from({ length: n }, (_, i) => ({ title: `Item ${i}`, revisions: 1 })), exclusions: "Ads spend", terms: "Monthly in advance" });

  it("saves, replaces by name, lists only your own, and deletes", async () => {
    const a = await rpc<string>(owner, "save_template", ["Social retainer", data()]);
    const again = await rpc<string>(owner, "save_template", ["social RETAINER", data(2)]);
    expect(again).toBe(a);
    const mine = await as<Json>(db, owner, "select name, jsonb_array_length(data -> 'deliverables') n from scope_templates");
    expect(mine).toEqual([{ name: "social RETAINER", n: 2 }]);
    expect(await as(db, other, "select * from scope_templates")).toEqual([]);
    await expect(rpc(other, "delete_template", [a])).rejects.toThrow(/not found/);
    await expect(as(db, owner, "insert into scope_templates (owner_id, name, data) values ($1, 'x', '{}')", [owner.id])).rejects.toThrow(/permission denied/);
    await rpc(owner, "delete_template", [a]);
    expect(await as(db, owner, "select * from scope_templates")).toEqual([]);
  });

  it("refuses bad input, too many and anonymous callers", async () => {
    await expect(rpc(owner, "save_template", [" ", data()])).rejects.toThrow(/name/);
    await expect(rpc(owner, "save_template", ["Empty", JSON.stringify({ deliverables: [] })])).rejects.toThrow(/between 1 and 50/);
    await expect(rpc(owner, "save_template", ["Huge", JSON.stringify({ deliverables: [{ title: "x".repeat(70000) }] })])).rejects.toThrow(/too large/);
    await expect(rpc(anon, "save_template", ["x", data()])).rejects.toThrow(/permission denied/);
    for (let i = 0; i < 50; i++) await rpc(other, "save_template", [`T${i}`, data()]);
    await expect(rpc(other, "save_template", ["T50", data()])).rejects.toThrow(/50 saved templates/);
    await rpc(other, "save_template", ["T7", data(3)]); // replacing an existing one is fine at the limit
  });
});

describe("migration", () => {
  it("re-runs and rolls back (twice), keeping per-unit lines as fixed-price lines", async () => {
    const fresh = await createDb();
    const u = await createUser(fresh, "mig@example.com", "Mig");
    const id = await rpc<string>(u, "save_project", [null, JSON.stringify({
      title: "M", currency: "INR", budget_cents: 1, client: { name: "C", email: "c@example.com" },
      deliverables: [{ title: "Posts", revisions_included: 1, pricing_type: "unit", quantity: "4", rate_cents: 250 }], milestones: [],
    })], fresh);
    await fresh.exec(readMigration("20261111000000_quotes.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select pricing_type, amount_cents::int a, rate_cents from deliverables where project_id = $1", [id])).rows).toEqual([{ pricing_type: "fixed", a: 1000, rate_cents: null }]);
    expect((await fresh.query<Json>("select to_regclass('public.scope_templates') is null as gone")).rows[0].gone).toBe(true);
    await fresh.exec(readMigration("20261111000000_quotes.sql"));
    expect((await fresh.query<Json>("select to_regproc('public.save_template') is not null as ok")).rows[0].ok).toBe(true);
  });
});
