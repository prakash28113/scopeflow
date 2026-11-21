/**
 * The migration runner and rollback against a real (in-memory) PostgreSQL: nothing is ever half-applied,
 * the history always matches the schema, and a rolled-back migration can be applied again.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
// @ts-expect-error plain JavaScript module (scripts run by GitHub Actions)
import { checkHistory, migrationSql, rollbackSql } from "../../scripts/ci/migrations.mjs";

const A = "20261201000000_widgets.sql";
const B = "20261202000000_widget_colour.sql";
const bodyA = "begin;\ncreate table public.widgets (id int primary key, name text);\ninsert into public.widgets values (1, 'kept');\ncommit;\n";
const bodyB = "begin;\nalter table public.widgets add column colour text default 'red';\ncommit;\n";
const downB = "begin;\nalter table public.widgets drop column if exists colour;\ncommit;\n";
let db: PGlite;

/** Runs SQL like the Supabase endpoint does: an error ends the session, which undoes the open transaction. */
async function run(sql: string) {
  try {
    await db.exec(sql);
  } catch (e) {
    await db.exec("rollback;");
    throw e;
  }
}

const history = async () => (await db.query<{ name: string }>("select name from scopeflow_admin.applied_migrations order by name")).rows.map((r) => r.name);
const hasTable = async (t: string) => (await db.query<{ p: boolean }>("select to_regclass($1) is not null as p", [t])).rows[0].p;
const hasColumn = async (c: string) => (await db.query<{ p: boolean }>("select exists (select 1 from information_schema.columns where table_name = 'widgets' and column_name = $1) as p", [c])).rows[0].p;

beforeEach(async () => {
  db = new PGlite();
  await db.exec("create schema scopeflow_admin; create table scopeflow_admin.applied_migrations (name text primary key, applied_at timestamptz not null default now(), checksum text);");
});

describe("applying a migration", () => {
  it("applies it and records it, together", async () => {
    await run(migrationSql(A, bodyA));
    expect(await hasTable("public.widgets")).toBe(true);
    expect(await history()).toEqual([A]);
  });

  it("a failing migration leaves neither the change nor a history row, and a retry works", async () => {
    const broken = migrationSql(B, "begin;\nalter table public.widgets add column colour text;\nselect 1/0;\ncommit;");
    await run(migrationSql(A, bodyA));
    await expect(run(broken)).rejects.toThrow();
    expect(await hasColumn("colour")).toBe(false);
    expect(await history()).toEqual([A]);
    await run(migrationSql(B, bodyB));
    expect(await hasColumn("colour")).toBe(true);
    expect(await history()).toEqual([A, B]);
  });

  it("if recording the history fails, the schema change is undone too (the old runner left it committed)", async () => {
    await run(migrationSql(A, bodyA));
    // Make the history insert fail: another runner already recorded B.
    await db.query("insert into scopeflow_admin.applied_migrations (name) values ($1)", [B]);
    await expect(run(migrationSql(B, bodyB))).rejects.toThrow(/duplicate key/);
    expect(await hasColumn("colour")).toBe(false);
  });

  it("an interrupted migration (error halfway) rolls everything back, including earlier statements in the file", async () => {
    const half = migrationSql(A, "begin;\ncreate table public.widgets (id int);\ncreate table public.more (id int);\nselect 1/0;\ncommit;");
    await expect(run(half)).rejects.toThrow();
    expect(await hasTable("public.widgets")).toBe(false);
    expect(await hasTable("public.more")).toBe(false);
    expect(await history()).toEqual([]);
  });

  it("applying the same migration twice is refused and changes nothing", async () => {
    await run(migrationSql(A, bodyA));
    await expect(run(migrationSql(A, bodyA))).rejects.toThrow();
    expect(((await db.query("select count(*)::int as n from public.widgets")).rows[0] as { n: number }).n).toBe(1);
  });

  it("an existing, populated database keeps its rows through a new migration", async () => {
    await run(migrationSql(A, bodyA));
    await db.exec("insert into public.widgets (id, name) values (2, 'second'), (3, 'third')");
    await run(migrationSql(B, bodyB));
    const rows = (await db.query<{ id: number; name: string; colour: string }>("select * from public.widgets order by id")).rows;
    expect(rows).toEqual([{ id: 1, name: "kept", colour: "red" }, { id: 2, name: "second", colour: "red" }, { id: 3, name: "third", colour: "red" }]);
  });

  it("records a checksum, and the history check then catches an edited migration", async () => {
    await run(migrationSql(A, bodyA));
    const applied = (await db.query<{ name: string; checksum: string }>("select name, checksum from scopeflow_admin.applied_migrations")).rows;
    expect(applied[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(checkHistory([{ name: A, body: bodyA }], applied).problems).toEqual([]);
    expect(checkHistory([{ name: A, body: bodyA + "-- edited" }], applied).problems).toHaveLength(1);
  });

  it("the runner takes a lock inside the transaction so two runners can't interleave", async () => {
    expect(migrationSql(A, bodyA)).toContain("pg_advisory_xact_lock(hashtext('scopeflow_admin.migrations'))");
    await run(migrationSql(A, bodyA)); // PGlite is single-connection; the lock statement itself must execute
  });
});

describe("rolling back", () => {
  beforeEach(async () => {
    await run(migrationSql(A, bodyA));
    await run(migrationSql(B, bodyB));
  });

  it("undoes the change and removes the history row, so the next release applies it again (deploy fails → rollback → retry)", async () => {
    await run(rollbackSql(B, downB));
    expect(await hasColumn("colour")).toBe(false);
    expect(await history()).toEqual([A]);
    // The retried release sees B as pending and applies it correctly.
    const pending = checkHistory([{ name: A, body: bodyA }, { name: B, body: bodyB }], (await db.query<{ name: string; checksum: string }>("select name, checksum from scopeflow_admin.applied_migrations")).rows).pending;
    expect(pending.map((f: { name: string }) => f.name)).toEqual([B]);
    await run(migrationSql(B, bodyB));
    expect(await hasColumn("colour")).toBe(true);
    expect(await history()).toEqual([A, B]);
  });

  it("keeps existing rows, and leaves no duplicate or contradictory history", async () => {
    await run(rollbackSql(B, downB));
    await run(migrationSql(B, bodyB));
    expect(((await db.query("select count(*)::int as n from public.widgets")).rows[0] as { n: number }).n).toBe(1);
    expect(((await db.query("select count(*)::int as n from scopeflow_admin.applied_migrations where name = $1", [B])).rows[0] as { n: number }).n).toBe(1);
  });

  it("a failing rollback script changes nothing and keeps the history row", async () => {
    await expect(run(rollbackSql(B, "begin;\nalter table public.widgets drop column colour;\nselect 1/0;\ncommit;"))).rejects.toThrow();
    expect(await hasColumn("colour")).toBe(true);
    expect(await history()).toEqual([A, B]);
  });

  it("refuses to roll back a migration that isn't recorded, or one that isn't the newest", async () => {
    await expect(run(rollbackSql("20261203000000_never_applied.sql", "select 1;"))).rejects.toThrow(/not recorded as applied/);
    await expect(run(rollbackSql(A, "begin;\ndrop table public.widgets;\ncommit;"))).rejects.toThrow(/newer migration/);
    expect(await hasTable("public.widgets")).toBe(true);
    expect(await history()).toEqual([A, B]);
  });
});
