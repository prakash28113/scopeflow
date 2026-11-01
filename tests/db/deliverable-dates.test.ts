/** Deliverable due dates: saved, part of the approved version, shown to the client, rollback. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261110000000_deliverable_due_dates_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
const project = (logoDue: string | null) => ({
  title: "Dated", currency: "INR", budget_cents: 1000, due_date: "2026-12-31",
  client: { name: "Dana", email: "dana@example.com" },
  deliverables: [{ title: "Logo", revisions_included: 1, due_date: logoDue }, { title: "Guide", revisions_included: 1 }],
  milestones: [],
});

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "dates@example.com", "Priya");
});

describe("deliverable due dates", () => {
  it("are saved, kept on edit, part of the version the client approves, and shown on the client page", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(project("2026-11-20"))]);
    expect((await as<Json>(db, owner, "select due_date::text d from deliverables where project_id = $1 order by position", [id])).map((r) => r.d)).toEqual(["2026-11-20", null]);
    await rpc(owner, "save_project", [id, JSON.stringify(project("2026-11-25"))]);
    const sent = await rpc<Json>(owner, "send_scope", [id, 30]);
    const token = (sent.link as Json).token as string;
    const view = await rpc<Json>(anon, "portal_view", [token]);
    const snapDeliverables = ((view.snapshot as Json).data as Json).deliverables as Json[];
    expect(snapDeliverables.map((d) => d.due_date)).toEqual(["2026-11-25", null]);
    await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null]);
    const after = await rpc<Json>(anon, "portal_view", [token]);
    expect((after.deliverables as Json[]).map((d) => d.due_date)).toEqual(["2026-11-25", null]);
    // The fingerprint covers the dates: the stored hash is of content that includes them.
    const [snap] = await as<{ data: Json }>(db, owner, "select data from scope_snapshots where project_id = $1", [id]);
    expect(JSON.stringify(snap.data)).toContain("2026-11-25");
  });
});

describe("migration", () => {
  it("re-runs and rolls back (twice), restoring the previous functions", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration("20261110000000_deliverable_due_dates.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select count(*)::int n from information_schema.columns where table_name = 'deliverables' and column_name = 'due_date'")).rows[0].n).toBe(0);
    expect((await fresh.query<Json>("select pg_get_functiondef('public._build_scope(uuid)'::regprocedure) like '%due_date%d.due_date%' as has")).rows[0].has).toBe(false);
    await fresh.exec(readMigration("20261110000000_deliverable_due_dates.sql"));
    expect((await fresh.query<Json>("select count(*)::int n from information_schema.columns where table_name = 'deliverables' and column_name = 'due_date'")).rows[0].n).toBe(1);
  });
});
