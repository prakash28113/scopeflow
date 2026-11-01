/**
 * Production-readiness checks for the v1.1 release (see docs/release/v1.1/).
 * Numbers in the describe titles match the audit checklist.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, migrationFiles, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const V10 = "20261031000000_scopeflow_schema.sql";
const V11 = "20261101000000_v1_1_agreement.sql";
const DOWN = readFileSync(new URL("../../supabase/rollback/20261101000000_v1_1_agreement_down.sql", import.meta.url), "utf8");

const base = {
  title: "Packaging design",
  currency: "INR",
  budget_cents: 8000000,
  due_date: "2026-12-15",
  client: { name: "Meera", email: "meera@client.example" },
  deliverables: [
    { title: "Box design", revisions_included: 2 },
    { title: "Label", revisions_included: 1 },
  ],
  milestones: [{ title: "Advance", amount_cents: 4000000, due_date: "2026-11-05" }],
};
const withTerms = { ...base, exclusions: "Printing\nPhotography", terms: "50% advance.", extra_revision_cents: 250000 };

function rpcOn(db: PGlite) {
  return async <T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
}

/** A v1.0 database holding a live, approved project with a client link and revision history. */
async function v10WithLiveProject() {
  const db = await createDb({ upTo: V10 });
  const rpc = rpcOn(db);
  const owner = await createUser(db, "studio@example.com", "Studio");
  const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(base)]);
  const sent = await rpc<Json>(owner, "send_scope", [id, 30]);
  const token = (sent.link as Json).token as string;
  const v = await rpc<Json>(anon, "portal_view", [token]);
  await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Meera", null]);
  const box = ((await rpc<Json>(anon, "portal_view", [token])).deliverables as Json[])[0].id as string;
  await rpc(anon, "portal_request_revision", [token, "revision", box, "Darker blue", "Meera"]);
  const draftId = await rpc<string>(owner, "save_project", [null, JSON.stringify({ ...base, title: "Draft brochure" })]);
  const hash = (await db.query<Json>("select content_hash from scope_snapshots where project_id = $1", [id])).rows[0].content_hash;
  return { db, rpc, owner, id, token, box, draftId, hash };
}

describe("1 · migrations are backward compatible and safe to re-run", () => {
  it("upgrades a v1.0 database with live data, and applying v1.1 twice changes nothing", async () => {
    const { db } = await v10WithLiveProject();
    await db.exec(readMigration(V11));
    const snapshot = async () =>
      (await db.query<Json>(`select
         (select count(*)::int from information_schema.columns where table_schema = 'public') as columns,
         (select count(*)::int from pg_indexes where schemaname = 'public') as indexes,
         (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace) as functions,
         (select count(*)::int from revision_requests) as revisions`)).rows[0];
    const once = await snapshot();
    await db.exec(readMigration(V11));
    expect(await snapshot()).toEqual(once);
  });

  it("every migration after v1.0 is written to be re-runnable", () => {
    for (const file of migrationFiles().filter((f) => f > V10)) {
      const sql = readMigration(file).replace(/--.*$/gm, "");
      expect(sql, file).not.toMatch(/create\s+table\s+(?!if not exists)/i);
      expect(sql, file).not.toMatch(/create\s+(unique\s+)?index\s+(?!if not exists)/i);
      expect(sql, file).not.toMatch(/add\s+column\s+(?!if not exists)/i);
      expect(sql, file).not.toMatch(/create\s+function/i); // always CREATE OR REPLACE
    }
  });

  it("a v1.0 app keeps working against the v1.1 database", async () => {
    const { db, rpc, owner, token, box, draftId } = await v10WithLiveProject();
    await db.exec(readMigration(V11));
    // Old save_project payload (no v1.1 keys) must not wipe v1.1 fields set by the new app.
    await rpc(owner, "save_project", [draftId, JSON.stringify(withTerms)]);
    await rpc(owner, "save_project", [draftId, JSON.stringify({ ...base, title: "Draft brochure v2" })]);
    const [p] = await as<Json>(db, owner, "select title, exclusions, terms, extra_revision_cents from projects where id = $1", [draftId]);
    expect(p).toEqual({ title: "Draft brochure v2", exclusions: "Printing\nPhotography", terms: "50% advance.", extra_revision_cents: 250000 });
    // Old portal call shape (5 arguments, no request id).
    const r = await rpc<Json>(anon, "portal_request_revision", [token, "revision", box, "Bigger logo", "Meera"]);
    expect(r).toMatchObject({ ok: true, in_scope: true, revision_number: 2 });
  });
});

describe("8 · existing projects and client links keep working after the upgrade", () => {
  it("the v1.0 link, approval, fingerprint and revision count survive", async () => {
    const { db, rpc, token, id, hash } = await v10WithLiveProject();
    await db.exec(readMigration(V11));
    const v = await rpc<Json>(anon, "portal_view", [token]);
    expect(v.error).toBeUndefined();
    expect((v.project as Json).status).toBe("active");
    expect((v.snapshot as Json).content_hash).toBe(hash);
    expect(((v.snapshot as Json).decision as Json).decision).toBe("approved");
    const [d] = v.deliverables as Json[];
    expect([d.revisions_used, d.revisions_extra]).toEqual([1, 0]);
    // v1.0 snapshots have no v1.1 keys; the app treats them as absent.
    expect(((v.snapshot as Json).data as Json).exclusions).toBeUndefined();
    const [{ n }] = (await db.query<Json>("select count(*)::int as n from activity_log where project_id = $1 and event = 'scope.viewed'", [id])).rows;
    expect(n).toBe(0); // already approved: not an "opened" event
  });
});

describe("2 · approved agreement versions are immutable", () => {
  it("snapshot, decision and agreed terms can't be changed by anyone after approval", async () => {
    const db = await createDb();
    const rpc = rpcOn(db);
    const owner = await createUser(db, "o@example.com");
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(withTerms)]);
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    const v = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Meera", null]);

    // Even the database superuser is stopped by the immutability triggers.
    await expect(db.query("update scope_snapshots set data = data || '{\"terms\":\"changed\"}'::jsonb")).rejects.toThrow(/immutable/);
    await expect(db.query("delete from scope_snapshots")).rejects.toThrow(/immutable/);
    await expect(db.query("update scope_decisions set decision = 'rejected'")).rejects.toThrow(/immutable/);
    // The owner can't edit the locked scope or its terms.
    await expect(rpc(owner, "save_project", [id, JSON.stringify({ ...withTerms, terms: "100% on delivery" })])).rejects.toThrow(/locked/);
    await expect(rpc(owner, "send_scope", [id, 30])).rejects.toThrow(/already been sent/);
    await expect(as(db, owner, "update projects set terms = 'x'")).rejects.toThrow(/permission denied/);

    const [s] = (await db.query<Json>("select data, content_hash, encode(sha256(convert_to(data::text,'UTF8')),'hex') as h from scope_snapshots where project_id = $1", [id])).rows;
    expect((s.data as Json).terms).toBe("50% advance.");
    expect(s.content_hash).toBe(s.h);
  });
});

describe("3 · revision counts can't be duplicated by retries or races", () => {
  async function approved() {
    const db = await createDb();
    const rpc = rpcOn(db);
    const owner = await createUser(db, "o@example.com");
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(base)]);
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    const v = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Meera", null]);
    const box = ((await rpc<Json>(anon, "portal_view", [token])).deliverables as Json[])[0].id as string;
    return { db, rpc, id, token, box };
  }

  it("a retried submission (same request id) is recorded once and returns the original result", async () => {
    const { db, rpc, id, token, box } = await approved();
    const rid = "6f1d1c0e-9a51-4c1e-8f4e-0d1b6e0a1a11";
    const first = await rpc<Json>(anon, "portal_request_revision", [token, "revision", box, "Darker", "Meera", rid]);
    const retry = await rpc<Json>(anon, "portal_request_revision", [token, "revision", box, "Darker", "Meera", rid]);
    expect(first).toMatchObject({ in_scope: true, revision_number: 1 });
    expect(retry).toMatchObject({ in_scope: true, revision_number: 1, duplicate: true });
    const rows = (await db.query<Json>("select revision_number from revision_requests where project_id = $1", [id])).rows;
    expect(rows).toEqual([{ revision_number: 1 }]);
    const [{ n }] = (await db.query<Json>("select count(*)::int as n from activity_log where project_id = $1 and event = 'revision.requested'", [id])).rows;
    expect(n).toBe(1);
  });

  it("separate submissions count up and stop at the limit", async () => {
    const { rpc, token, box } = await approved();
    const ids = ["1b0f1c0e-9a51-4c1e-8f4e-0d1b6e0a1a01", "1b0f1c0e-9a51-4c1e-8f4e-0d1b6e0a1a02", "1b0f1c0e-9a51-4c1e-8f4e-0d1b6e0a1a03"];
    const results: Json[] = [];
    for (const rid of ids) results.push(await rpc<Json>(anon, "portal_request_revision", [token, "revision", box, "x", "Meera", rid]));
    expect(results.map((r) => [r.in_scope, r.revision_number])).toEqual([[true, 1], [true, 2], [false, null]]);
  });

  it("the database itself refuses a second row with the same included revision number", async () => {
    const { db, id, rpc, token, box } = await approved();
    await rpc(anon, "portal_request_revision", [token, "revision", box, "x", "Meera"]);
    await expect(
      db.query("insert into revision_requests (project_id, deliverable_id, kind, description, requested_by, in_scope, revision_number) values ($1, $2, 'revision', 'dup', 'x', true, 1)", [id, box]),
    ).rejects.toThrow(/revision_requests_number_once/);
  });

  it("requests on a project are serialized by a row lock (checked in the function source)", async () => {
    const { db } = await approved();
    const [{ src }] = (await db.query<Json>("select prosrc as src from pg_proc where proname = '_portal_gate'")).rows;
    expect(String(src)).toMatch(/for update/i);
  });
});

describe("4 · rejecting a change order leaves the agreement untouched", () => {
  it("budget, dates, milestones and the approved snapshot are unchanged", async () => {
    const db = await createDb();
    const rpc = rpcOn(db);
    const owner = await createUser(db, "o@example.com");
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(withTerms)]);
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    const v = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Meera", null]);

    const state = async () =>
      (await db.query<Json>(`select p.budget_cents, p.approved_extras_cents, p.due_date::text, p.extra_days, p.status, p.terms,
          (select json_agg(json_build_object('t', title, 'a', amount_cents, 's', status) order by position) from milestones where project_id = p.id) as ms,
          (select json_agg(content_hash order by version) from scope_snapshots where project_id = p.id) as snaps
        from projects p where p.id = $1`, [id])).rows[0];
    const before = await state();

    const coId = await rpc<string>(owner, "create_change_order", [id, JSON.stringify({ title: "Extra label", pricing_type: "fixed", amount_cents: 500000, additional_days: 5 })]);
    const r = await rpc<Json>(anon, "portal_decide_change_order", [token, coId, "rejected", "Meera", "Not now"]);
    expect(r).toMatchObject({ ok: true, decision: "rejected" });

    expect(await state()).toEqual(before);
    const [co] = (await db.query<Json>("select status from change_orders where id = $1", [coId])).rows;
    expect(co.status).toBe("rejected");
    await expect(rpc(anon, "portal_decide_change_order", [token, coId, "approved", "Meera", null])).rejects.toThrow();
  });
});

describe("5 · every privileged operation checks the caller", () => {
  it("each SECURITY DEFINER function verifies ownership, the client link, or the signed-in user", async () => {
    const db = await createDb();
    const rows = (await db.query<Json>("select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace and prosecdef")).rows;
    // Functions that legitimately need no per-project check, and why:
    const exempt: Record<string, string> = {
      health: "public liveness ping; returns 'ok' and purges expired rate counters",
      _handle_new_user: "auth trigger; runs only on sign-up",
    };
    const unguarded = rows
      .filter((r) => !(String(r.proname) in exempt))
      .filter((r) => !/_owned_project\(|_portal_gate\(|_uid\(\)|auth\.uid\(\)/.test(String(r.prosrc)))
      .map((r) => r.proname);
    expect(unguarded).toEqual([]);
    expect(rows.length).toBeGreaterThan(15);
  });
});

describe("7 · database rollback", () => {
  it("rolls v1.1 back, keeps v1.0 data and links working, and can be run twice", async () => {
    const { db, rpc, token, box, id, hash } = await v10WithLiveProject();
    await db.exec(readMigration(V11));
    await rpc(anon, "portal_request_revision", [token, "revision", box, "v1.1 era request", "Meera", "2c0f1c0e-9a51-4c1e-8f4e-0d1b6e0a1a01"]);
    await db.exec(DOWN);
    await db.exec(DOWN);
    const v = await rpc<Json>(anon, "portal_view", [token]);
    expect((v.snapshot as Json).content_hash).toBe(hash);
    expect((v.deliverables as Json[])[0].revisions_used).toBe(2);
    expect((v.deliverables as Json[])[0].revisions_extra).toBeUndefined();
    const r = await rpc<Json>(anon, "portal_request_revision", [token, "revision", box, "after rollback", "Meera"]);
    expect(r).toMatchObject({ in_scope: false });
    const [{ n }] = (await db.query<Json>("select count(*)::int as n from projects where id = $1", [id])).rows;
    expect(n).toBe(1);
    // …and forward again.
    await db.exec(readMigration(V11));
    expect((await rpc<Json>(anon, "portal_view", [token])).error).toBeUndefined();
  });
});
