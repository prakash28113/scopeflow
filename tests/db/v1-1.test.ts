/**
 * v1.1: agreement details (exclusions, terms, extra-revision price) and the
 * "viewed" step of the approval timeline.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, type Role } from "./harness";

type Json = Record<string, unknown>;
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };

const payload = {
  title: "Website redesign",
  currency: "INR",
  budget_cents: 5000000,
  client: { name: "Ravi", email: "ravi@client.example" },
  deliverables: [{ title: "Homepage design", revisions_included: 2 }],
  milestones: [{ title: "Advance", amount_cents: 2500000 }],
  exclusions: "Copywriting\nStock photo licences",
  terms: "50% advance. Final files after full payment.",
  extra_revision_cents: 300000,
};

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0].r;
}
const viewedEvents = (projectId: string) =>
  as<Json>(db, owner, "select summary, metadata from activity_log where project_id = $1 and event = 'scope.viewed' order by created_at", [projectId]);

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com", "Owner");
  other = await createUser(db, "other@example.com", "Other");
});

describe("agreement details", () => {
  it("saves exclusions, terms and the extra-revision price, trimming blanks to null", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(payload)]);
    const [p] = await as<Json>(db, owner, "select exclusions, terms, extra_revision_cents from projects where id = $1", [id]);
    expect(p).toEqual({ exclusions: "Copywriting\nStock photo licences", terms: payload.terms, extra_revision_cents: 300000 });

    await rpc(owner, "save_project", [id, JSON.stringify({ ...payload, exclusions: "   ", terms: "", extra_revision_cents: null })]);
    const [q] = await as<Json>(db, owner, "select exclusions, terms, extra_revision_cents from projects where id = $1", [id]);
    expect(q).toEqual({ exclusions: null, terms: null, extra_revision_cents: null });
  });

  it("rejects oversized or negative values", async () => {
    await expect(rpc(owner, "save_project", [null, JSON.stringify({ ...payload, terms: "x".repeat(4001) })])).rejects.toThrow(/check constraint/);
    await expect(rpc(owner, "save_project", [null, JSON.stringify({ ...payload, extra_revision_cents: -1 })])).rejects.toThrow(/check constraint/);
  });

  it("puts them in the locked scope the client approves, covered by its fingerprint", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(payload)]);
    const sent = await rpc<Json>(owner, "send_scope", [id, 30]);
    const token = (sent.link as Json).token as string;
    const v = await rpc<Json>(anon, "portal_view", [token]);
    const data = (v.snapshot as Json).data as Json;
    expect(data.exclusions).toBe(payload.exclusions);
    expect(data.terms).toBe(payload.terms);
    expect(data.extra_revision_cents).toBe(300000);
    const [snap] = await as<Json>(db, owner, "select content_hash, encode(sha256(convert_to(data::text, 'UTF8')), 'hex') as recomputed from scope_snapshots where project_id = $1", [id]);
    expect(snap.content_hash).toBe(snap.recomputed);

    // Once sent, the terms can't be edited (and certainly not after approval).
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Ravi", null]);
    await expect(rpc(owner, "save_project", [id, JSON.stringify({ ...payload, terms: "changed" })])).rejects.toThrow(/locked/);
  });

  it("can't be written directly or by another account", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(payload)]);
    await expect(as(db, owner, "update projects set terms = 'x' where id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(rpc(other, "save_project", [id, JSON.stringify(payload)])).rejects.toThrow();
    expect(await as(db, other, "select terms from projects where id = $1", [id])).toEqual([]);
    expect(await as(db, anon, "select terms from projects").catch((e) => String(e))).toMatch(/permission denied/);
  });
});

describe("approval timeline: viewed", () => {
  it("records the first open of each scope version awaiting a decision, once", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(payload)]);
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    expect(await viewedEvents(id)).toEqual([]);

    await rpc(anon, "portal_view", [token]);
    await rpc(anon, "portal_view", [token]);
    const events = await viewedEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Client opened scope v1");

    // A new version after "changes requested" gets its own entry; a decided version doesn't.
    const v1 = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (v1.snapshot as Json).id, "rejected", "Ravi", "Add a page"]);
    await rpc(anon, "portal_view", [token]);
    expect(await viewedEvents(id)).toHaveLength(1);
    await rpc(owner, "send_scope", [id, 30]);
    await rpc(anon, "portal_view", [token]);
    const after = await viewedEvents(id);
    expect(after.map((e) => (e.metadata as Json).version)).toEqual([1, 2]);
  });

  it("records nothing for drafts or bad links, and the public response stays minimal", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(payload)]);
    const token = (await rpc<Json>(owner, "rotate_share_link", [id, 30])).token as string;
    const v = await rpc<Json>(anon, "portal_view", [token]);
    expect(v.snapshot).toBeNull();
    expect(await viewedEvents(id)).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/owner_id|ravi@client\.example/);
    expect((await rpc<Json>(anon, "portal_view", ["Q".repeat(43)])).error).toBe("invalid_link");
  });
});

describe("rollback", () => {
  it("removes v1.1 cleanly and the migration re-applies", async () => {
    const fresh = await createDb();
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    await fresh.exec(read("../../supabase/rollback/20261101000000_v1_1_agreement_down.sql"));
    const cols = await fresh.query<Json>("select column_name from information_schema.columns where table_name = 'projects' and column_name in ('exclusions','terms','extra_revision_cents')");
    expect(cols.rows).toEqual([]);
    await fresh.exec(read("../../supabase/migrations/20261101000000_v1_1_agreement.sql"));
    const again = await fresh.query<Json>("select count(*)::int as n from information_schema.columns where table_name = 'projects' and column_name in ('exclusions','terms','extra_revision_cents')");
    expect(again.rows[0].n).toBe(3);
  });
});

describe("revision tracker", () => {
  it("reports included, used and extra rounds per deliverable to the client", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify({ ...payload, deliverables: [{ title: "Logo", revisions_included: 1 }] })]);
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    const v = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Ravi", null]);
    const deliverableId = ((await rpc<Json>(anon, "portal_view", [token])).deliverables as Json[])[0].id;
    for (const text of ["Bolder", "Bluer", "Rounder"]) {
      await rpc(anon, "portal_request_revision", [token, "revision", deliverableId, text, "Ravi"]);
    }
    const [d] = (await rpc<Json>(anon, "portal_view", [token])).deliverables as Json[];
    expect([d.revisions_included, d.revisions_used, d.revisions_extra]).toEqual([1, 1, 2]);
  });
});
