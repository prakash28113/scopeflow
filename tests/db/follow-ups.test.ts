/** Follow-up reminders: owner-only, validated, done/undone, deletable, rollback. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261108000000_follow_ups_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };
const today = new Date().toISOString().slice(0, 10);

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "fu@example.com", "Priya");
  other = await createUser(db, "fu-other@example.com", "Other");
});

describe("follow-ups", () => {
  it("are added with a date and optional project, marked done and undone, and deleted", async () => {
    const pid = await rpc<string>(owner, "save_project", [null, JSON.stringify({
      title: "FU", currency: "INR", budget_cents: 100, client: { name: "D", email: "d@example.com" },
      deliverables: [{ title: "X", revisions_included: 1 }], milestones: [],
    })]);
    const id = await rpc<string>(owner, "add_follow_up", [JSON.stringify({ due_on: today, note: "Call Dana about final files", project_id: pid })]);
    expect((await as<Json>(db, owner, "select note, project_id, done_at from follow_ups where id = $1", [id]))[0]).toEqual({ note: "Call Dana about final files", project_id: pid, done_at: null });
    await rpc(owner, "set_follow_up_done", [id, true]);
    expect((await as<Json>(db, owner, "select done_at from follow_ups where id = $1", [id]))[0].done_at).not.toBeNull();
    await rpc(owner, "set_follow_up_done", [id, false]);
    expect((await as<Json>(db, owner, "select done_at from follow_ups where id = $1", [id]))[0].done_at).toBeNull();
    await expect(rpc(other, "set_follow_up_done", [id, true])).rejects.toThrow(/Follow-up not found/);
    await expect(rpc(other, "delete_follow_up", [id])).rejects.toThrow(/Follow-up not found/);
    expect((await as<Json>(db, other, "select count(*)::int n from follow_ups"))[0].n).toBe(0);
    await rpc(owner, "delete_follow_up", [id]);
    expect((await as<Json>(db, owner, "select count(*)::int n from follow_ups"))[0].n).toBe(0);
  });

  it("are validated and can't be written directly or by anyone else", async () => {
    await expect(rpc(owner, "add_follow_up", [JSON.stringify({ due_on: today, note: "  " })])).rejects.toThrow(/Write what to follow up on/);
    await expect(rpc(owner, "add_follow_up", [JSON.stringify({ due_on: "2020-01-01", note: "x" })])).rejects.toThrow(/Pick a date/);
    await expect(rpc(owner, "add_follow_up", [JSON.stringify({ due_on: "2999-01-01", note: "x" })])).rejects.toThrow(/Pick a date/);
    const pid = await rpc<string>(owner, "save_project", [null, JSON.stringify({
      title: "Mine", currency: "INR", budget_cents: 100, client: { name: "D", email: "d@example.com" },
      deliverables: [{ title: "X", revisions_included: 1 }], milestones: [],
    })]);
    await expect(rpc(other, "add_follow_up", [JSON.stringify({ due_on: today, note: "x", project_id: pid })])).rejects.toThrow(/Project not found/);
    await expect(rpc(anon, "add_follow_up", [JSON.stringify({ due_on: today, note: "x" })])).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "insert into follow_ups (owner_id, due_on, note) values ($1, current_date, 'x')", [owner.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, "select * from follow_ups")).rejects.toThrow(/permission denied/);
  });
});

describe("migration", () => {
  it("re-runs and rolls back (twice) cleanly", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration("20261108000000_follow_ups.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select to_regclass('public.follow_ups') is null as gone")).rows[0].gone).toBe(true);
    await fresh.exec(readMigration("20261108000000_follow_ups.sql"));
    expect((await fresh.query<Json>("select to_regproc('public.add_follow_up') is not null as ok")).rows[0].ok).toBe(true);
  });
});
