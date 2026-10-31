import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, createUser } from "./harness";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MIGRATION = read("../../supabase/migrations/20261031000000_scopeflow_schema.sql");
const TEARDOWN = read("../../supabase/rollback/teardown.sql");
const RESTORE_TRIGGER = read("../../supabase/rollback/restore-auth-trigger.sql");

describe("teardown / reinstall", () => {
  it("removes every ScopeFlow object, leaves auth users, and the migration re-applies cleanly", async () => {
    const db = await createDb();
    await createUser(db, "keep@example.com");
    await db.exec(TEARDOWN);

    const leftovers = await db.query<{ kind: string; name: string }>(`
      select 'table' as kind, relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p','v','m','S')
      union all select 'function', proname from pg_proc where pronamespace = 'public'::regnamespace
      union all select 'type', typname from pg_type where typnamespace = 'public'::regnamespace and typtype = 'e'
      union all select 'trigger', tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal`);
    expect(leftovers.rows).toEqual([]);
    expect((await db.query("select 1 from auth.users where email = 'keep@example.com'")).rows).toHaveLength(1);

    // Reinstall on the same database works (e.g. after a failed first install).
    await db.exec(MIGRATION);
    const tables = await db.query("select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'");
    expect(tables.rows).toHaveLength(14);
  });

  it("restore-auth-trigger.sql brings back the sign-up trigger (missing after a Supabase restore)", async () => {
    const db = await createDb();
    await db.exec("drop trigger on_auth_user_created on auth.users"); // what a restored project looks like
    await db.exec("insert into auth.users (email) values ('ghost@example.com')");
    expect((await db.query("select 1 from profiles where email = 'ghost@example.com'")).rows).toHaveLength(0);

    await db.exec(RESTORE_TRIGGER);
    await db.exec(RESTORE_TRIGGER); // idempotent
    await createUser(db, "back@example.com");
    expect((await db.query("select 1 from profiles where email = 'back@example.com'")).rows).toHaveLength(1);
  });
});
