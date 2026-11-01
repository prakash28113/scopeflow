// Races real, separate PostgreSQL connections against ScopeFlow's portal functions.
// Uses an embedded PostgreSQL 17 server (no install, no network) and the real migrations.
// Usage: (cd tests/concurrency && npm ci && npm test)
import pg from "pg";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = new URL("../../", import.meta.url).pathname;
// PostgreSQL 17 binaries from npm (@embedded-postgres/linux-x64): no system install, no network.
const BIN = new URL("./node_modules/@embedded-postgres/linux-x64/native/bin", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "scopeflow-race-"));
const dir = join(work, "data");
const port = 55000 + Math.floor(Math.random() * 5000);
const results = [];
const check = (name, fn) => results.push({ name, fn });
writeFileSync(join(work, "pw"), "postgres\n");
execFileSync(join(BIN, "initdb"), [`--pgdata=${dir}`, "--username=postgres", `--pwfile=${join(work, "pw")}`, "--auth=password", "--locale=C", "--encoding=UTF8"], { stdio: "pipe" });
execFileSync(join(BIN, "pg_ctl"), ["-D", dir, "-l", join(work, "log"), "-w", "-o", `-p ${port} -k ${work} -c max_connections=60`, "start"], { stdio: "pipe" });
const server = { stop: async () => execFileSync(join(BIN, "pg_ctl"), ["-D", dir, "-m", "fast", "-w", "stop"], { stdio: "pipe" }) };

const conn = () => new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });

try {
  const admin = conn();
  await admin.connect();
  await admin.query(readFileSync(join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
  for (const f of readdirSync(join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  }

  const ownerId = randomUUID();
  await admin.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'race@example.com', '{\"full_name\":\"Race\"}')", [ownerId]);

  /** Runs one function call as a role on its own connection (= its own transaction). */
  async function call(role, fn, args) {
    const c = conn();
    await c.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role === "anon" ? "anon" : "authenticated"}`);
      if (role !== "anon") await c.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      const ph = args.map((_, i) => `$${i + 1}`).join(", ");
      const r = await c.query(`select public.${fn}(${ph}) as r`, args);
      await c.query("commit");
      return { ok: true, value: r.rows[0].r };
    } catch (e) {
      await c.query("rollback").catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      await c.end();
    }
  }

  async function approvedProject(revisions = 2) {
    const id = (await call("owner", "save_project", [null, JSON.stringify({
      title: `Race ${randomUUID().slice(0, 6)}`, currency: "INR", budget_cents: 100000,
      client: { name: "Client", email: `c${randomUUID().slice(0, 6)}@example.com` },
      deliverables: [{ title: "Logo", revisions_included: revisions }], milestones: [],
    })])).value;
    const token = (await call("owner", "send_scope", [id, 30])).value.link.token;
    const view = (await call("anon", "portal_view", [token])).value;
    return { id, token, snapshotId: view.snapshot.id };
  }
  const approve = async (p) => {
    await call("anon", "portal_decide_scope", [p.token, p.snapshotId, "approved", "Client", null]);
    p.deliverableId = (await call("anon", "portal_view", [p.token])).value.deliverables[0].id;
    return p;
  };

  check("8 simultaneous revision requests: exactly the 2 included rounds are numbered 1 and 2", async () => {
    const p = await approve(await approvedProject(2));
    const out = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      call("anon", "portal_request_revision", [p.token, "revision", p.deliverableId, `change ${i}`, "Client", randomUUID()])));
    assert.ok(out.every((o) => o.ok), JSON.stringify(out.filter((o) => !o.ok)));
    const rows = (await admin.query("select revision_number from revision_requests where project_id = $1 and in_scope order by 1", [p.id])).rows;
    assert.deepEqual(rows.map((r) => r.revision_number), [1, 2]);
    const extra = (await admin.query("select count(*)::int n from revision_requests where project_id = $1 and not in_scope", [p.id])).rows[0].n;
    assert.equal(extra, 6);
  });

  check("8 simultaneous retries of one submission: recorded once", async () => {
    const p = await approve(await approvedProject(2));
    const rid = randomUUID();
    const out = await Promise.all(Array.from({ length: 8 }, () =>
      call("anon", "portal_request_revision", [p.token, "revision", p.deliverableId, "same change", "Client", rid])));
    assert.ok(out.every((o) => o.ok));
    assert.equal(out.filter((o) => o.value.duplicate).length, 7);
    const n = (await admin.query("select count(*)::int n from revision_requests where project_id = $1", [p.id])).rows[0].n;
    assert.equal(n, 1);
  });

  check("simultaneous approve and reject of one scope version: exactly one decision", async () => {
    const p = await approvedProject(2);
    const out = await Promise.all([
      call("anon", "portal_decide_scope", [p.token, p.snapshotId, "approved", "Client", null]),
      call("anon", "portal_decide_scope", [p.token, p.snapshotId, "rejected", "Client", "no"]),
      call("anon", "portal_decide_scope", [p.token, p.snapshotId, "approved", "Client", null]),
    ]);
    assert.equal(out.filter((o) => o.ok && !o.value?.error).length, 1, JSON.stringify(out));
    const n = (await admin.query("select count(*)::int n from scope_decisions where project_id = $1", [p.id])).rows[0].n;
    assert.equal(n, 1);
  });

  check("a change order approved twice at once adds its price once", async () => {
    const p = await approve(await approvedProject(2));
    const coId = (await call("owner", "create_change_order", [p.id, JSON.stringify({ title: "Extra", pricing_type: "fixed", amount_cents: 5000, additional_days: 2 })])).value;
    const out = await Promise.all(Array.from({ length: 4 }, () => call("anon", "portal_decide_change_order", [p.token, coId, "approved", "Client", null])));
    assert.equal(out.filter((o) => o.ok && !o.value?.error).length, 1, JSON.stringify(out));
    const [row] = (await admin.query("select approved_extras_cents::int a, extra_days d from projects where id = $1", [p.id])).rows;
    assert.deepEqual(row, { a: 5000, d: 2 });
    const ms = (await admin.query("select count(*)::int n from milestones where change_order_id = $1", [coId])).rows[0].n;
    assert.equal(ms, 1);
  });

  let failed = 0;
  for (const r of results) {
    try {
      await r.fn();
      console.log(`✓ ${r.name}`);
    } catch (e) {
      failed++;
      console.log(`✗ ${r.name}\n  ${e.message}`);
    }
  }
  await admin.end();
  console.log(failed ? `\n${failed} of ${results.length} concurrency checks FAILED` : `\nAll ${results.length} concurrency checks passed on real PostgreSQL (${execFileSync(join(BIN, "postgres"), ["--version"]).toString().trim()})`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await server.stop().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
