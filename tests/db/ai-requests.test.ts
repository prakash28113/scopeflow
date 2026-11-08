/** AI allowance and audit history: owner-only, project isolation, daily limit, rollback. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261119000000_ai_requests_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
const project = (role: Role, title: string) =>
  rpc<string>(role, "save_project", [null, JSON.stringify({ title, currency: "INR", budget_cents: 100, client: { name: "D", email: "d@example.com" }, deliverables: [{ title: "X", revisions_included: 1 }], milestones: [] })]);

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "ai@example.com", "Priya");
  other = await createUser(db, "ai-other@example.com", "Other");
});

describe("AI requests", () => {
  it("starts and finishes an audit row, and counts down the daily allowance", async () => {
    expect(await rpc<number>(owner, "ai_remaining", [])).toBe(30);
    const begun = await rpc<{ id: string; remaining: number }>(owner, "ai_begin", ["scope_draft", null]);
    expect(begun.remaining).toBe(29);
    await rpc(owner, "ai_finish", [begun.id, "cloudflare:llama", true]);
    const row = (await as<Json>(db, owner, "select task, provider, ok, finished_at is not null as done from ai_requests where id = $1", [begun.id]))[0];
    expect(row).toEqual({ task: "scope_draft", provider: "cloudflare:llama", ok: true, done: true });
    expect(await rpc<number>(owner, "ai_remaining", [])).toBe(29);
    // Finishing twice, or someone else's row, changes nothing.
    await rpc(owner, "ai_finish", [begun.id, "other", false]);
    await rpc(other, "ai_finish", [begun.id, "other", false]);
    expect((await as<Json>(db, owner, "select provider, ok from ai_requests where id = $1", [begun.id]))[0]).toEqual({ provider: "cloudflare:llama", ok: true });
  });

  it("only allows the caller's own projects (context isolation)", async () => {
    const mine = await project(owner, "Mine");
    const begun = await rpc<{ id: string }>(owner, "ai_begin", ["change_impact", mine]);
    expect(begun.id).toBeTruthy();
    await expect(rpc(other, "ai_begin", ["change_impact", mine])).rejects.toThrow(/Project not found/);
    await expect(rpc(owner, "ai_begin", ["write_my_blog", null])).rejects.toThrow(/Unknown AI task/);
  });

  it("stops at the daily limit", async () => {
    const used = (await as<{ n: number }>(db, owner, "select count(*)::int n from ai_requests"))[0].n;
    for (let i = used; i < 30; i++) await rpc(owner, "ai_begin", ["assistant", null]);
    expect(await rpc<number>(owner, "ai_remaining", [])).toBe(0);
    await expect(rpc(owner, "ai_begin", ["assistant", null])).rejects.toThrow(/used today's 30 AI suggestions/);
    // Someone else's allowance is separate.
    expect(await rpc<number>(other, "ai_remaining", [])).toBe(30);
  });

  it("can't be written directly, read by others or used signed out", async () => {
    await expect(as(db, owner, "insert into ai_requests (owner_id, task) values ($1, 'assistant')", [owner.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "update ai_requests set ok = false")).rejects.toThrow(/permission denied/);
    expect((await as<{ n: number }>(db, other, "select count(*)::int n from ai_requests"))[0].n).toBe(0);
    await expect(as(db, anon, "select * from ai_requests")).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "ai_begin", ["assistant", null])).rejects.toThrow(/permission denied/);
  });
});

describe("migration", () => {
  it("re-runs and rolls back (twice) cleanly", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration("20261119000000_ai_requests.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select to_regclass('public.ai_requests') is null as gone")).rows[0].gone).toBe(true);
    await fresh.exec(readMigration("20261119000000_ai_requests.sql"));
    expect((await fresh.query<Json>("select to_regproc('public.ai_begin') is not null as ok")).rows[0].ok).toBe(true);
  });
});
