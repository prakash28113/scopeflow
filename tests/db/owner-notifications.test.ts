/** T2-12: one queued email to the owner per client action, per-type switches, and never a blocked client. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, service, type Role } from "./harness";

type Json = Record<string, unknown>;
const NAME = "20261123000000_owner_notifications";
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[], on: PGlite = db): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(on, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
async function sent(who: Role = owner, title = `N ${Math.random().toString(36).slice(2, 7)}`) {
  const id = await rpc<string>(who, "save_project", [null, JSON.stringify({
    title, currency: "INR", budget_cents: 100000,
    client: { name: "Dana", email: "dana@example.com" },
    deliverables: [{ title: "Logo", revisions_included: 1 }], milestones: [],
  })]);
  const token = ((await rpc<Json>(who, "send_scope", [id, 30])).link as Json).token as string;
  const view = await rpc<Json>(anon, "portal_view", [token]);
  return { id, token, snapshot: (view.snapshot as Json).id as string };
}
const queue = async (projectId?: string) =>
  (await db.query<Json>(`select kind, event, actor_name, owner_id from owner_emails ${projectId ? "where project_id = $1" : ""} order by created_at`, projectId ? [projectId] : [])).rows;

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com", "Priya");
  other = await createUser(db, "other@example.com", "Other");
});

describe("owner notification emails", () => {
  it("queues exactly one email for the owner per client action, of the right kind", async () => {
    const p = await sent();
    expect(await queue(p.id)).toEqual([]); // the freelancer's own actions (save, send) queue nothing
    await rpc(anon, "portal_decide_scope", [p.token, p.snapshot, "rejected", "Dana", "Please add a favicon"]);
    expect(await queue(p.id)).toEqual([{ kind: "changes_requested", event: "scope.rejected", actor_name: "Dana", owner_id: owner.id }]);

    const q = await sent();
    await rpc(anon, "portal_decide_scope", [q.token, q.snapshot, "approved", "Dana", null]);
    const [{ id: logo }] = await as<{ id: string }>(db, owner, "select id from deliverables where project_id = $1", [q.id]);
    await rpc(anon, "portal_request_revision", [q.token, "revision", logo, "Bolder type", "Dana"]);
    const co = await rpc<string>(owner, "create_change_order", [q.id, JSON.stringify({ title: "Business cards", description: "Two-sided cards", pricing_type: "fixed", amount_cents: 250000 })]);
    await rpc(anon, "portal_decide_change_order", [q.token, co, "approved", "Dana", null]);
    const co2 = await rpc<string>(owner, "create_change_order", [q.id, JSON.stringify({ title: "Letterhead", description: "A4", pricing_type: "fixed", amount_cents: 100000 })]);
    await rpc(anon, "portal_decide_change_order", [q.token, co2, "rejected", "Dana", "Not now"]);
    expect((await queue(q.id)).map((r) => `${r.kind}:${r.event}`)).toEqual([
      "scope_approved:scope.approved",
      "changes_requested:revision.requested",
      "change_order_decided:change_order.approved",
      "change_order_decided:change_order.rejected",
    ]);
    // Nothing for anyone else, and nothing addressed to the client: the queue has no client contact column.
    expect((await queue()).every((r) => r.owner_id === owner.id)).toBe(true);
    const cols = (await db.query<{ c: string }>("select column_name as c from information_schema.columns where table_name = 'owner_emails' order by 1")).rows.map((r) => r.c);
    expect(cols).toEqual(["actor_name", "attempts", "created_at", "event", "id", "kind", "last_error", "owner_id", "project_id", "sent_at", "summary"]);
  });

  it("a type that's switched off queues nothing; the others still do", async () => {
    expect(await rpc(owner, "set_notification_prefs", [JSON.stringify({ scope_approved: false })])).toEqual({ scope_approved: false });
    const p = await sent();
    await rpc(anon, "portal_decide_scope", [p.token, p.snapshot, "approved", "Dana", null]);
    expect(await queue(p.id)).toEqual([]);
    const [{ id: logo }] = await as<{ id: string }>(db, owner, "select id from deliverables where project_id = $1", [p.id]);
    await rpc(anon, "portal_request_revision", [p.token, "revision", logo, "Bolder", "Dana"]);
    expect((await queue(p.id)).map((r) => r.kind)).toEqual(["changes_requested"]);
    // Back on; other keys are kept; junk is refused; one account can't change another's.
    expect(await rpc(owner, "set_notification_prefs", [JSON.stringify({ scope_approved: true, changes_requested: false, sneaky: true })])).toEqual({ scope_approved: true, changes_requested: false });
    await expect(rpc(owner, "set_notification_prefs", [JSON.stringify({ scope_approved: "yes" })])).rejects.toThrow(/on or off/);
    await expect(rpc(anon, "set_notification_prefs", ["{}"])).rejects.toThrow(/permission denied/);
    expect((await as<Json>(db, other, "select notify_prefs from profiles"))[0].notify_prefs).toEqual({});
    await rpc(owner, "set_notification_prefs", [JSON.stringify({ changes_requested: true })]);
  });

  it("the client's action still succeeds when queueing the email fails", async () => {
    const p = await sent();
    await db.exec("alter table public.owner_emails rename to owner_emails_broken");
    try {
      const r = await rpc<Json>(anon, "portal_decide_scope", [p.token, p.snapshot, "approved", "Dana", null]);
      expect(r).not.toHaveProperty("error");
      expect((await as<Json>(db, owner, "select status from projects where id = $1", [p.id]))[0].status).toBe("active");
    } finally {
      await db.exec("alter table public.owner_emails_broken rename to owner_emails");
    }
    expect(await queue(p.id)).toEqual([]);
  });

  it("the sender takes each email once, gives up after five tries, and nobody else can touch the queue", async () => {
    await db.exec("delete from public.owner_emails");
    const p = await sent(owner, "Brand refresh");
    await rpc(anon, "portal_decide_scope", [p.token, p.snapshot, "approved", "Dana", null]);
    const claimed = await rpc<Json[]>(service, "notify_claim", [10]);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ kind: "scope_approved", event: "scope.approved", actor_name: "Dana", project_id: p.id, project_title: "Brand refresh", to_email: "owner@example.com", to_name: "Priya" });
    expect(JSON.stringify(claimed)).not.toContain("dana@example.com"); // the client's email never leaves the database
    await rpc(service, "notify_mark", [claimed[0].id, false, "Brevo answered 500"]);
    expect((await db.query<Json>("select attempts, sent_at, last_error from owner_emails")).rows).toEqual([{ attempts: 1, sent_at: null, last_error: "Brevo answered 500" }]);
    for (let i = 0; i < 4; i++) expect(await rpc<Json[]>(service, "notify_claim", [10])).toHaveLength(1);
    expect(await rpc<Json[]>(service, "notify_claim", [10])).toEqual([]); // five tries used up
    await db.exec("update public.owner_emails set attempts = 0");
    const again = await rpc<Json[]>(service, "notify_claim", [10]);
    await rpc(service, "notify_mark", [again[0].id, true, null]);
    expect(await rpc<Json[]>(service, "notify_claim", [10])).toEqual([]); // sent: never again
    for (const role of [owner, anon]) {
      await expect(as(db, role, "select * from owner_emails")).rejects.toThrow(/permission denied/);
      await expect(rpc(role, "notify_claim", [10])).rejects.toThrow(/permission denied/);
      await expect(rpc(role, "notify_mark", [again[0].id, true, null])).rejects.toThrow(/permission denied/);
    }
  });

  it("rollback removes it all and the migration re-applies", async () => {
    const fresh = await createDb();
    const down = readFileSync(new URL(`../../supabase/rollback/${NAME}_down.sql`, import.meta.url), "utf8");
    await fresh.exec(down);
    await fresh.exec(down);
    expect((await fresh.query("select to_regclass('public.owner_emails') as t")).rows).toEqual([{ t: null }]);
    expect((await fresh.query("select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'notify_prefs'")).rows).toEqual([]);
    await fresh.exec(readMigration(`${NAME}.sql`));
    await fresh.exec(readMigration(`${NAME}.sql`));
    expect((await fresh.query("select 1 from pg_trigger where tgname = 'activity_log_owner_email'")).rows).toHaveLength(1);
  });
});
