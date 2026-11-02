/**
 * Runs the exact SQL that scripts/ci/release.mjs sends to Supabase against a
 * real Postgres (PGlite + Supabase stand-in), through a fake Management API.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SUPABASE_STUB, createDb } from "./harness";
// @ts-expect-error — plain ESM script
import { run, allowlistSql, parseEmails, CLOSED_SENTINEL, EXPECTED, billingConfig, purchasableSql } from "../../scripts/ci/release.mjs";

const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
const REF = "abcdefghijklmnopqrst";

async function freshDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  return db;
}

/** A fake Supabase Management API whose /database/query runs on the real database. */
function fakeSupabase(db: PGlite) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (u.pathname === "/v1/projects") return json(200, [{ id: REF, ref: REF, name: "scopeflow-beta", status: "ACTIVE_HEALTHY", region: "ap-south-1" }]);
    if (u.pathname.endsWith("/database/query")) {
      try {
        const res = await db.exec(body.query);
        const last = res[res.length - 1];
        return json(201, last?.rows ?? []);
      } catch (e) {
        try { await db.exec("rollback"); } catch {}
        return json(400, { message: (e as Error).message });
      }
    }
    if (u.pathname.endsWith("/config/auth")) return json(200, {});
    if (u.pathname.endsWith("/api-keys")) return json(200, [{ type: "publishable", name: "default", api_key: "sb_publishable_abc123" }]);
    return json(404, { message: "not mocked" });
  };
  return { fetch, calls };
}

const deps = (fetch: unknown, extra: Record<string, unknown> = {}) => ({
  env: { SUPABASE_ACCESS_TOKEN: "sbp_test" },
  fetch,
  exec: () => "",
  log: () => {},
  summary: () => {},
  migrations,
  allowlistFile: "owner@example.com",
  wait: async () => {},
  ...extra,
});

describe("release automation against a real database", () => {
  it("installs on a fresh project, passes the security check, and syncs the allowlist", async () => {
    const db = await freshDb();
    const api = fakeSupabase(db);
    expect(await run(deps(api.fetch))).toBe("waiting-cloudflare");

    expect((await db.query("select count(*)::int as n from pg_tables where schemaname = 'public'")).rows[0]).toEqual({ n: EXPECTED.tables });
    expect((await db.query("select name from scopeflow_admin.applied_migrations")).rows).toEqual(migrations.map((m) => ({ name: m.name })));
    expect((await db.query("select email from public.beta_allowlist")).rows).toEqual([{ email: "owner@example.com" }]);
    const auth = api.calls.find((c) => c.path.endsWith("/config/auth"));
    expect(auth?.body).toMatchObject({ mailer_autoconfirm: true, password_min_length: 8, external_email_enabled: true });
  });

  it("is idempotent: a second run applies nothing and changes nothing", async () => {
    const db = await freshDb();
    await run(deps(fakeSupabase(db).fetch));
    const api = fakeSupabase(db);
    expect(await run(deps(api.fetch))).toBe("waiting-cloudflare");
    const migrationCalls = api.calls.filter((c) => c.path.endsWith("/database/query") && String((c.body as { query: string }).query).includes("create table public.projects"));
    expect(migrationCalls).toHaveLength(0);
  });

  it("keeps sign-ups closed when nobody is invited, and removes un-listed invites", async () => {
    const db = await freshDb();
    await run(deps(fakeSupabase(db).fetch, { allowlistFile: "a@example.com\nb@example.com" }));
    await run(deps(fakeSupabase(db).fetch, { allowlistFile: "b@example.com" }));
    expect((await db.query("select email from public.beta_allowlist order by 1")).rows).toEqual([{ email: "b@example.com" }]);
    await run(deps(fakeSupabase(db).fetch, { allowlistFile: "# nobody yet" }));
    expect((await db.query("select email from public.beta_allowlist")).rows).toEqual([{ email: CLOSED_SENTINEL }]);
    // Closed means closed: an arbitrary sign-up is rejected by the database.
    await expect(db.query("insert into auth.users (email) values ('someone@example.com')")).rejects.toThrow(/private beta/);
  });

  it("refuses to touch a database that already has an unrecorded ScopeFlow install", async () => {
    const db = await freshDb();
    await db.exec(migrations[0].body); // e.g. someone ran it by hand
    await expect(run(deps(fakeSupabase(db).fetch))).rejects.toThrow(/teardown\.sql/);
  });

  it("rolls back a failing migration completely (nothing recorded, nothing half-created)", async () => {
    const db = await freshDb();
    const broken = [{ name: "20990101000000_broken.sql", body: "create table public.half_done (id int);\nselect this_is_not_sql;" }];
    await expect(run(deps(fakeSupabase(db).fetch, { migrations: broken }))).rejects.toThrow(/failed/);
    expect((await db.query("select to_regclass('public.half_done') as t")).rows[0]).toEqual({ t: null });
    expect((await db.query("select count(*)::int as n from scopeflow_admin.applied_migrations")).rows[0]).toEqual({ n: 0 });
  });

  it("the private bookkeeping schema is invisible to API roles", async () => {
    const db = await freshDb();
    await run(deps(fakeSupabase(db).fetch));
    for (const role of ["anon", "authenticated"]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.query("select * from scopeflow_admin.applied_migrations");
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("allowlist input safety", () => {
  it("rejects anything that isn't a plain email (no SQL injection)", () => {
    expect(() => parseEmails("ok@example.com'); drop table public.projects; --")).toThrow(/Not a valid email/);
    expect(() => parseEmails("x@y")).toThrow();
    expect(parseEmails(" A@Example.com, b@example.com\n# c@example.com\nA@example.com ")).toEqual(["a@example.com", "b@example.com"]);
    expect(allowlistSql([])).toContain(CLOSED_SENTINEL);
  });
});

describe("putting plans on sale", () => {
  it("live keys sell the configured plans; test keys or none sell nothing", async () => {
    const db = await createDb();
    const onSale = async () => (await db.query<{ id: string }>("select id from plans where purchasable order by position")).rows.map((r) => r.id);
    const keys = { RAZORPAY_KEY_SECRET: "12345678", RAZORPAY_WEBHOOK_SECRET: "12345678" };
    await db.exec(purchasableSql(billingConfig({ ...keys, RAZORPAY_KEY_ID: "rzp_live_abcdef12" }, JSON.stringify({ billingPlans: ["solo"] }))));
    expect(await onSale()).toEqual(["solo"]);
    await db.exec(purchasableSql(billingConfig({ ...keys, RAZORPAY_KEY_ID: "rzp_test_abcdef12" }, "{}")));
    expect(await onSale()).toEqual([]);
    await db.exec(purchasableSql(null));
    expect(await onSale()).toEqual([]);
  });
});
