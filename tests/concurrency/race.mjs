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
  const hasPlans = (await admin.query("select to_regproc('public.admin_set_plan') is not null as ok")).rows[0].ok;
  // The race account needs many projects: give it an unlimited plan (limits are raced separately below).
  if (hasPlans) await admin.query("select public.admin_set_plan('race@example.com', 'studio', 'active', 'year', null, 'race test')");
  const freeId = randomUUID();
  await admin.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'race-free@example.com', '{\"full_name\":\"Free\"}')", [freeId]);

  /** Runs one function call as a role on its own connection (= its own transaction). */
  async function call(role, fn, args, as = ownerId) {
    const c = conn();
    await c.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role === "anon" ? "anon" : "authenticated"}`);
      if (role !== "anon") await c.query("select set_config('request.jwt.claim.sub', $1, true)", [as]);
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

  check("client link and logged WhatsApp requests at the same time: still exactly 2 included rounds; a double-tapped log is recorded once", async () => {
    const p = await approve(await approvedProject(2));
    const rid = randomUUID();
    const logged = (i, id = randomUUID()) =>
      call("owner", "log_client_request", [p.id, JSON.stringify({ kind: "revision", deliverable_id: p.deliverableId, description: `logged ${i}`, source: "whatsapp", client_request_id: id })]);
    const out = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => call("anon", "portal_request_revision", [p.token, "revision", p.deliverableId, `link ${i}`, "Client", randomUUID()])),
      ...Array.from({ length: 4 }, (_, i) => logged(i)),
      ...Array.from({ length: 3 }, () => logged("same", rid)),
    ]);
    assert.ok(out.every((o) => o.ok), JSON.stringify(out.filter((o) => !o.ok)));
    const rows = (await admin.query("select revision_number from revision_requests where project_id = $1 and in_scope order by 1", [p.id])).rows;
    assert.deepEqual(rows.map((r) => r.revision_number), [1, 2]);
    const total = (await admin.query("select count(*)::int n from revision_requests where project_id = $1", [p.id])).rows[0].n;
    assert.equal(total, 9);
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

  const hasInvoices = (await admin.query("select to_regproc('public.create_invoice') is not null as ok")).rows[0].ok;
  if (hasInvoices) {
    check("8 simultaneous invoices for different payments: 8 distinct, consecutive numbers", async () => {
      const ms = [];
      for (let k = 0; k < 4; k++) {
        const id = (await call("owner", "save_project", [null, JSON.stringify({
          title: `Inv race ${k}`, currency: "INR", budget_cents: 2000,
          client: { name: "C", email: `inv${k}@example.com` },
          deliverables: [{ title: "X", revisions_included: 1 }],
          milestones: [{ title: "A", amount_cents: 1000 }, { title: "B", amount_cents: 1000 }],
        })])).value;
        const token = (await call("owner", "send_scope", [id, 30])).value.link.token;
        const snap = (await call("anon", "portal_view", [token])).value.snapshot.id;
        await call("anon", "portal_decide_scope", [token, snap, "approved", "C", null]);
        ms.push(...(await admin.query("select id from milestones where project_id = $1", [id])).rows.map((r) => r.id));
      }
      const before = (await admin.query("select invoice_seq from profiles where id = $1", [ownerId])).rows[0].invoice_seq;
      const out = await Promise.all(ms.map((m) => call("owner", "create_invoice", [m, "{}"])));
      assert.ok(out.every((o) => o.ok), JSON.stringify(out.filter((o) => !o.ok)));
      const nums = (await admin.query("select number from client_invoices where milestone_id = any($1::uuid[]) order by number", [ms])).rows.map((r) => Number(r.number.split("-").pop()));
      assert.deepEqual(nums, Array.from({ length: 8 }, (_, i) => before + i + 1));
    });

    check("6 simultaneous invoices for the same payment: exactly 1 is created", async () => {
      const id = (await call("owner", "save_project", [null, JSON.stringify({
        title: "Same payment", currency: "INR", budget_cents: 1000, client: { name: "C", email: "same-inv@example.com" },
        deliverables: [{ title: "X", revisions_included: 1 }], milestones: [{ title: "All", amount_cents: 1000 }],
      })])).value;
      const token = (await call("owner", "send_scope", [id, 30])).value.link.token;
      const snap = (await call("anon", "portal_view", [token])).value.snapshot.id;
      await call("anon", "portal_decide_scope", [token, snap, "approved", "C", null]);
      const [{ id: m }] = (await admin.query("select id from milestones where project_id = $1", [id])).rows;
      const out = await Promise.all(Array.from({ length: 6 }, () => call("owner", "create_invoice", [m, "{}"])));
      assert.equal(out.filter((o) => o.ok).length, 1, JSON.stringify(out));
      const n = (await admin.query("select count(*)::int n from client_invoices where milestone_id = $1", [m])).rows[0].n;
      assert.equal(n, 1);
    });
  }

  const hasPayments = (await admin.query("select to_regproc('public.record_payment') is not null as ok")).rows[0].ok;
  if (hasPayments) {
    check("4 simultaneous part payments of 60% each: exactly 1 is recorded, never more than the amount due", async () => {
      const id = (await call("owner", "save_project", [null, JSON.stringify({
        title: "Pay race", currency: "INR", budget_cents: 10000, client: { name: "C", email: "pay-race@example.com" },
        deliverables: [{ title: "X", revisions_included: 1 }], milestones: [{ title: "All", amount_cents: 10000 }],
      })])).value;
      const token = (await call("owner", "send_scope", [id, 30])).value.link.token;
      const snap = (await call("anon", "portal_view", [token])).value.snapshot.id;
      await call("anon", "portal_decide_scope", [token, snap, "approved", "C", null]);
      const [{ id: m }] = (await admin.query("select id from milestones where project_id = $1", [id])).rows;
      const out = await Promise.all(Array.from({ length: 4 }, () => call("owner", "record_payment", [m, JSON.stringify({ amount_cents: 6000 })])));
      assert.equal(out.filter((o) => o.ok).length, 1, JSON.stringify(out));
      const [row] = (await admin.query("select paid_cents::int p, status from milestones where id = $1", [m])).rows;
      assert.deepEqual(row, { p: 6000, status: "pending" });
      const sum = (await admin.query("select coalesce(sum(amount_cents),0)::int s from payments where milestone_id = $1", [m])).rows[0].s;
      assert.equal(sum, 6000);
    });
  }

  if (hasPlans) {
    check("6 simultaneous project creations on the Free plan: exactly 2 succeed, the rest get the plan-limit error", async () => {
      const out = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        call("owner", "save_project", [null, JSON.stringify({
          title: `Free race ${i}`, currency: "INR", budget_cents: 1000, client: { name: "C", email: "same@example.com" },
          deliverables: [{ title: "Logo", revisions_included: 1 }], milestones: [],
        })], freeId)));
      assert.equal(out.filter((o) => o.ok).length, 2, JSON.stringify(out));
      assert.ok(out.filter((o) => !o.ok).every((o) => /Free plan includes 2 active projects/.test(o.error)), JSON.stringify(out));
      const n = (await admin.query("select count(*)::int n from projects where owner_id = $1", [freeId])).rows[0].n;
      assert.equal(n, 2);
    });
  }

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
