/** T2-11: limit_hit and checkout_open counts. Owner-only, nothing personal, written through one function. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, service, type Role } from "./harness";

type Json = Record<string, unknown>;
let db: PGlite;
let a: Role & { id: string };
let b: Role & { id: string };
const log = (u: Role, event: string, detail: string) => as<{ r: boolean }>(db, u, "select public.log_usage_event($1, $2) as r", [event, detail]).then((r) => r[0].r);
const mine = (u: Role) => as<Json>(db, u, "select owner_id, event, detail from usage_events order by created_at, event");

beforeAll(async () => {
  db = await createDb();
  a = await createUser(db, "a@example.com", "A");
  b = await createUser(db, "b@example.com", "B");
});

describe("usage events", () => {
  it("a signed-in account records its own events and reads only its own", async () => {
    expect(await log(a, "limit_hit", "active_projects")).toBe(true);
    expect(await log(a, "checkout_open", "limit")).toBe(true);
    expect(await log(b, "limit_hit", "clients")).toBe(true);
    expect(await mine(a)).toEqual([
      { owner_id: a.id, event: "limit_hit", detail: "active_projects" },
      { owner_id: a.id, event: "checkout_open", detail: "limit" },
    ]);
    expect(await mine(b)).toEqual([{ owner_id: b.id, event: "limit_hit", detail: "clients" }]);
  });
  it("nobody can write to the table directly, for themselves or anyone else", async () => {
    await expect(as(db, a, "insert into usage_events (owner_id, event, detail) values ($1, 'limit_hit', 'clients')", [a.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, a, "insert into usage_events (owner_id, event, detail) values ($1, 'limit_hit', 'clients')", [b.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, a, "update usage_events set detail = 'clients'")).rejects.toThrow(/permission denied/);
    await expect(as(db, a, "delete from usage_events")).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, "select * from usage_events")).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, "select public.log_usage_event('limit_hit', 'clients')")).rejects.toThrow(/permission denied/);
  });
  it("only the fixed events and details are accepted: no free text, so nothing personal", async () => {
    for (const [e, d] of [["limit_hit", "limit"], ["checkout_open", "clients"], ["signed_in", "plan"], ["limit_hit", "asha@example.com"], ["checkout_open", ""]]) {
      await expect(log(a, e, d), `${e}/${d}`).rejects.toThrow(/Unknown event/);
    }
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'usage_events' order by 1")).rows.map((r) => r.column_name);
    expect(cols).toEqual(["created_at", "detail", "event", "id", "owner_id"]);
  });
  it("stops counting after 50 a day per account, without an error", async () => {
    const c = await createUser(db, "c@example.com", "C");
    for (let i = 0; i < 50; i++) expect(await log(c, "checkout_open", "plan")).toBe(true);
    expect(await log(c, "checkout_open", "plan")).toBe(false);
    expect((await mine(c)).length).toBe(50);
    expect(await log(a, "checkout_open", "pricing")).toBe(true); // other accounts are unaffected
  });
  it("totals are for the SQL editor only", async () => {
    for (const role of [a, anon, service]) await expect(as(db, role, "select * from public.admin_usage_counts()")).rejects.toThrow(/permission denied/);
    const rows = (await db.query<Json>("select event, detail, all_time::int, accounts::int from public.admin_usage_counts()")).rows;
    expect(rows).toEqual([
      { event: "checkout_open", detail: "limit", all_time: 1, accounts: 1 },
      { event: "checkout_open", detail: "plan", all_time: 50, accounts: 1 },
      { event: "checkout_open", detail: "pricing", all_time: 1, accounts: 1 },
      { event: "limit_hit", detail: "active_projects", all_time: 1, accounts: 1 },
      { event: "limit_hit", detail: "clients", all_time: 1, accounts: 1 },
    ]);
  });
  it("rollback removes it and the migration re-applies", async () => {
    const fresh = await createDb();
    const down = readFileSync(new URL("../../supabase/rollback/20261122000000_usage_events_down.sql", import.meta.url), "utf8");
    await fresh.exec(down);
    await fresh.exec(down);
    expect((await fresh.query("select to_regclass('public.usage_events') as t")).rows).toEqual([{ t: null }]);
    await fresh.exec(readMigration("20261122000000_usage_events.sql"));
    await fresh.exec(readMigration("20261122000000_usage_events.sql"));
    expect((await fresh.query<Json>("select relrowsecurity from pg_class where relname = 'usage_events'")).rows).toEqual([{ relrowsecurity: true }]);
  });
});
