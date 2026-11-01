/** Encrypted backups: everything is exported, only the passphrase opens it, and it restores exactly. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createDb, createUser, migrationFiles, type Role } from "./harness";
// @ts-expect-error plain JavaScript module (scripts run by GitHub Actions)
import { decrypt, encrypt, exportDatabase, pack, restoreSql, summary, unpack } from "../../scripts/backup/lib.mjs";
// @ts-expect-error plain JavaScript module
import { verifyRestore } from "../../scripts/backup/backup.mjs";

type Json = Record<string, unknown>;
type Backup = { format: string; created_at: string; migrations: string[]; tables: Record<string, Json[]> };
const PASS = "correct horse battery staple 2026";
let db: PGlite;
let backup: Backup;
const rowsOf = (d: PGlite) => (q: string) => d.query<Json>(q).then((r) => r.rows);

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}

async function recordMigrations(d: PGlite) {
  await d.exec("create schema if not exists scopeflow_admin; create table if not exists scopeflow_admin.applied_migrations (name text primary key, applied_at timestamptz not null default now());");
  for (const f of migrationFiles()) await d.query("insert into scopeflow_admin.applied_migrations (name) values ($1) on conflict do nothing", [f]);
}

beforeAll(async () => {
  db = await createDb();
  await recordMigrations(db);
  const owner = await createUser(db, "backup@example.com", "Priya O'Neil");
  // A realistic project: approved scope, a request, a payment, quotes and dollar signs in text.
  const id = await rpc<string>(owner, "save_project", [null, JSON.stringify({
    title: "Café rebrand — “phase 1” $$ 'quoted'", currency: "INR", budget_cents: 500000,
    client: { name: "Dana", email: "dana@example.com" },
    deliverables: [{ title: "Logo", revisions_included: 2, due_date: "2026-12-01" }],
    milestones: [{ title: "Deposit", amount_cents: 250000, due_date: "2026-11-20" }],
  })]);
  const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
  const view = await as<{ r: Json }>(db, { kind: "anon" }, "select public.portal_view($1) as r", [token]);
  await as(db, { kind: "anon" }, "select public.portal_decide_scope($1, $2, 'approved', 'Dana', null)", [token, ((view[0].r.snapshot as Json).id)]);
  await rpc(owner, "log_client_request", [id, JSON.stringify({ kind: "new_work", description: "Cup sleeves $sf$ too", source: "whatsapp" })]);
  backup = await exportDatabase(rowsOf(db), new Date("2026-11-08T21:37:00Z"));
}, 120_000);

describe("export", () => {
  it("holds every public table, the sign-in accounts and the database version", async () => {
    const publicTables = (await db.query<{ t: string }>("select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).rows.map((r) => `public.${r.t}`);
    expect(Object.keys(backup.tables)).toEqual(expect.arrayContaining([...publicTables, "auth.users", "scopeflow_admin.applied_migrations"]));
    expect(backup.migrations.at(-1)).toBe(migrationFiles().at(-1));
    expect(backup.tables["public.projects"]).toHaveLength(1);
    expect(backup.tables["public.revision_requests"][0]).toMatchObject({ source: "whatsapp", description: "Cup sleeves $sf$ too" });
    expect(summary(backup)).toMatchObject({ created_at: "2026-11-08T21:37:00.000Z", tables: Object.keys(backup.tables).length });
  });
});

describe("encryption", () => {
  it("only the passphrase opens it, and any change to the file is detected", () => {
    const file: Buffer = pack(backup, PASS);
    expect(file.subarray(0, 4).toString()).toBe("SFBK");
    expect(file.includes(Buffer.from("dana@example.com"))).toBe(false);
    expect(unpack(file, PASS)).toEqual(backup);
    expect(() => unpack(file, "correct horse battery staple 2027")).toThrow(/Wrong passphrase/);
    for (const at of [6, 20, 40, file.length - 1]) {
      const bad = Buffer.from(file);
      bad[at] ^= 1;
      expect(() => decrypt(bad, PASS)).toThrow();
    }
    expect(() => decrypt(Buffer.from("not a backup at all, definitely not one"), PASS)).toThrow(/Not a ScopeFlow backup/);
  });

  it("refuses a missing or short passphrase, and never reuses a key", () => {
    expect(() => encrypt(Buffer.from("x"), "")).toThrow(/BACKUP_PASSPHRASE/);
    expect(() => encrypt(Buffer.from("x"), "short pass")).toThrow(/at least 20/);
    const a: Buffer = encrypt(Buffer.from("same"), PASS);
    const b: Buffer = encrypt(Buffer.from("same"), PASS);
    expect(a.subarray(8, 36).equals(b.subarray(8, 36))).toBe(false); // fresh salt and IV each time
  });
});

describe("restore", () => {
  it("loads into a fresh database with the same migrations and comes back identical", async () => {
    const fresh = await createDb();
    await recordMigrations(fresh);
    await fresh.query("delete from scopeflow_admin.applied_migrations");
    await fresh.exec(restoreSql(unpack(pack(backup, PASS), PASS)));
    const again = await exportDatabase(rowsOf(fresh), new Date("2026-11-08T21:37:00Z"));
    expect(again.tables).toEqual(backup.tables);
    // Restored data works: the owner still sees their project through the normal rules.
    const owner = { kind: "user" as const, id: backup.tables["auth.users"][0].id as string };
    expect(await as(fresh, owner, "select title from projects")).toEqual([{ title: "Café rebrand — “phase 1” $$ 'quoted'" }]);
    // Loading twice changes nothing.
    await fresh.exec(restoreSql(backup));
    expect((await exportDatabase(rowsOf(fresh))).tables).toEqual(backup.tables);
    await fresh.close();
  }, 120_000);

  it("the weekly job's restore check passes, and catches a table that doesn't load", async () => {
    expect([...(await verifyRestore(backup))]).toEqual([]);
    const broken = structuredClone(backup);
    broken.tables["public.not_a_table"] = [{ id: 1 }];
    expect([...(await verifyRestore(broken))]).toEqual(["public.not_a_table (missing)"]);
  }, 120_000);
});
