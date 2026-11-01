/** Deliverable progress and the expense log: ownership, rules, timeline, client page, rollback. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261106000000_progress_and_expenses_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
async function project(approve: boolean) {
  const id = await rpc<string>(owner, "save_project", [null, JSON.stringify({
    title: `P ${Math.random().toString(36).slice(2, 7)}`, currency: "INR", budget_cents: 100000,
    client: { name: "Dana", email: "dana@example.com" },
    deliverables: [{ title: "Logo", revisions_included: 2 }, { title: "Guide", revisions_included: 1 }],
    milestones: [],
  })]);
  const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
  if (approve) {
    const view = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null]);
  }
  const ds = await as<{ id: string }>(db, owner, "select id from deliverables where project_id = $1 order by position", [id]);
  return { id, token, logo: ds[0].id, guide: ds[1].id };
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "prog@example.com", "Priya");
  other = await createUser(db, "prog-other@example.com", "Other");
  await rpc(owner, "complete_onboarding", ["Priya", "Raman Studio", "INR"]);
});

describe("deliverable progress", () => {
  it("is tracked after approval, logged in the timeline, and shown to the client", async () => {
    const p = await project(true);
    await rpc(owner, "set_deliverable_progress", [p.logo, "in_progress"]);
    await rpc(owner, "set_deliverable_progress", [p.logo, "delivered"]);
    await rpc(owner, "set_deliverable_progress", [p.logo, "delivered"]); // no-op, not logged twice
    const [d] = await as<Json>(db, owner, "select progress, progress_updated_at from deliverables where id = $1", [p.logo]);
    expect(d.progress).toBe("delivered");
    expect(d.progress_updated_at).not.toBeNull();
    const log = await as<{ summary: string }>(db, owner, "select summary from activity_log where project_id = $1 and event = 'deliverable.progress' order by created_at", [p.id]);
    expect(log.map((l) => l.summary)).toEqual(["Logo marked in progress", "Logo marked delivered"]);
    const view = await rpc<Json>(anon, "portal_view", [p.token]);
    expect((view.deliverables as Json[]).map((x) => x.progress)).toEqual(["delivered", "not_started"]);
  });

  it("is refused before approval, for other accounts, and for unknown states", async () => {
    const draft = await project(false);
    await expect(rpc(owner, "set_deliverable_progress", [draft.logo, "in_progress"])).rejects.toThrow(/once the client has approved/);
    const p = await project(true);
    await expect(rpc(other, "set_deliverable_progress", [p.logo, "delivered"])).rejects.toThrow(/Deliverable not found/);
    await expect(rpc(anon, "set_deliverable_progress", [p.logo, "delivered"])).rejects.toThrow(/permission denied/);
    await expect(rpc(owner, "set_deliverable_progress", [p.logo, "done"])).rejects.toThrow(/Choose not started/);
    await expect(as(db, owner, "update deliverables set progress = 'delivered' where id = $1", [p.logo])).rejects.toThrow(/permission denied/);
  });
});

describe("expenses", () => {
  it("are added, validated, private to the owner, and deletable", async () => {
    const p = await project(true);
    const id = await rpc<string>(owner, "add_expense", [JSON.stringify({ spent_on: "2026-10-15", category: "software", description: "Figma", amount_cents: 120000, project_id: p.id })]);
    const [e] = await as<Json>(db, owner, "select category, amount_cents, currency, project_id from expenses where id = $1", [id]);
    expect(e).toEqual({ category: "software", amount_cents: 120000, currency: "INR", project_id: p.id });
    await expect(rpc(owner, "add_expense", [JSON.stringify({ spent_on: "2026-10-15", amount_cents: 0 })])).rejects.toThrow(/greater than zero/);
    await expect(rpc(owner, "add_expense", [JSON.stringify({ spent_on: "2999-01-01", amount_cents: 100 })])).rejects.toThrow(/not in the future/);
    await expect(rpc(owner, "add_expense", [JSON.stringify({ spent_on: "2026-10-15", amount_cents: 100, category: "yacht" })])).rejects.toThrow(/check constraint/);
    await expect(rpc(other, "add_expense", [JSON.stringify({ spent_on: "2026-10-15", amount_cents: 100, project_id: p.id })])).rejects.toThrow(/Project not found/);
    expect((await as<Json>(db, other, "select count(*)::int n from expenses"))[0].n).toBe(0);
    await expect(as(db, anon, "select * from expenses")).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "insert into expenses (owner_id, spent_on, category, amount_cents, currency) values ($1, current_date, 'other', 1, 'INR')", [owner.id])).rejects.toThrow(/permission denied/);
    await expect(rpc(other, "delete_expense", [id])).rejects.toThrow(/Expense not found/);
    await rpc(owner, "delete_expense", [id]);
    expect((await as<Json>(db, owner, "select count(*)::int n from expenses where id = $1", [id]))[0].n).toBe(0);
  });
});

describe("migration", () => {
  it("re-runs and rolls back (twice) cleanly, restoring the previous client page", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration("20261106000000_progress_and_expenses.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    const q = async (sql: string) => (await fresh.query<Json>(sql)).rows[0];
    expect((await q("select to_regclass('public.expenses') is null as gone")).gone).toBe(true);
    expect((await q("select count(*)::int n from information_schema.columns where table_name = 'deliverables' and column_name = 'progress'")).n).toBe(0);
    expect((await q("select pg_get_functiondef('public.portal_view(text)'::regprocedure) like '%client_invoices%' as has")).has).toBe(true);
    await fresh.exec(readMigration("20261106000000_progress_and_expenses.sql"));
    expect((await q("select to_regproc('public.add_expense') is not null as ok")).ok).toBe(true);
  });
});
