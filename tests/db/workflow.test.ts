import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { anon, as, createDb, createUser, type Role } from "./harness";

type Json = Record<string, unknown>;

let db: PGlite;
let alice: Role & { id: string };
let bob: Role & { id: string };

const projectPayload = {
  title: "Brand identity for Northwind",
  summary: "Logo, palette and brand guidelines",
  currency: "USD",
  budget_cents: 300000,
  start_date: "2026-11-02",
  due_date: "2026-11-30",
  client: { name: "Dana Client", email: "Dana@Northwind.example", company: "Northwind" },
  deliverables: [
    { title: "Logo", description: "Primary + secondary marks", revisions_included: 2 },
    { title: "Brand guidelines", revisions_included: 1 },
  ],
  milestones: [
    { title: "Deposit", amount_cents: 150000 },
    { title: "Final delivery", amount_cents: 150000, due_date: "2026-11-30" },
  ],
};

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0].r;
}

async function createProject(owner: Role) {
  const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(projectPayload)]);
  const link = await rpc<{ token: string; expires_at: string }>(owner, "rotate_share_link", [id, 30]);
  return { id, token: link.token };
}

async function view(token: string) {
  return rpc<Json & { project: Json; snapshot: Json; deliverables: Json[]; milestones: Json[] }>(
    anon,
    "portal_view",
    [token],
  );
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, "alice@example.com", "Alice Designer");
  bob = await createUser(db, "bob@example.com", "Bob Editor");
});

describe("onboarding", () => {
  it("creates a profile on signup and completes onboarding", async () => {
    const before = await as<Json>(db, alice, "select full_name, onboarded_at from profiles");
    expect(before).toEqual([{ full_name: "Alice Designer", onboarded_at: null }]);
    await rpc(alice, "complete_onboarding", ["Alice Designer", "Alice Studio", "usd"]);
    const after = await as<Json>(db, alice, "select business_name, default_currency, onboarded_at from profiles");
    expect(after[0].business_name).toBe("Alice Studio");
    expect(after[0].default_currency).toBe("USD");
    expect(after[0].onboarded_at).not.toBeNull();
  });
});

describe("main workflow", () => {
  let projectId: string;
  let token: string;

  it("creates a draft project with client, deliverables and milestones", async () => {
    ({ id: projectId, token } = await createProject(alice));
    const [p] = await as<Json>(db, alice, "select status, budget_cents from projects where id = $1", [projectId]);
    expect(p.status).toBe("draft");
    expect(Number(p.budget_cents)).toBe(300000);
    const clients = await as<Json>(db, alice, "select email from clients");
    expect(clients[0].email).toBe("dana@northwind.example");
    const d = await as(db, alice, "select * from deliverables where project_id = $1", [projectId]);
    expect(d).toHaveLength(2);
  });

  it("portal shows nothing to decide before the scope is sent", async () => {
    const v = await view(token);
    expect(v.snapshot).toBeNull();
    expect((v.project as Json).status).toBe("draft");
  });

  it("sends an immutable scope snapshot", async () => {
    const res = await rpc<Json>(alice, "send_scope", [projectId]);
    expect(res.version).toBe(1);
    expect(String(res.content_hash)).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      db.query("update scope_snapshots set data = '{}'::jsonb where project_id = $1", [projectId]),
    ).rejects.toThrow(/immutable/);
    await expect(db.query("delete from scope_snapshots where project_id = $1", [projectId])).rejects.toThrow(
      /immutable/,
    );
  });

  it("locks the scope while awaiting approval", async () => {
    await expect(rpc(alice, "save_project", [projectId, JSON.stringify(projectPayload)])).rejects.toThrow(
      /locked/,
    );
  });

  it("requires a comment when the client rejects", async () => {
    const v = await view(token);
    await expect(
      rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "rejected", "Dana", "  "]),
    ).rejects.toThrow(/describe what needs to change/);
  });

  it("client rejects, freelancer edits and resends v2", async () => {
    const v1 = await view(token);
    await rpc(anon, "portal_decide_scope", [token, (v1.snapshot as Json).id, "rejected", "Dana", "Add a favicon"]);
    const [p] = await as<Json>(db, alice, "select status from projects where id = $1", [projectId]);
    expect(p.status).toBe("changes_requested");

    const edited = {
      ...projectPayload,
      deliverables: [...projectPayload.deliverables, { title: "Favicon", revisions_included: 1 }],
    };
    await rpc(alice, "save_project", [projectId, JSON.stringify(edited)]);
    const res = await rpc<Json>(alice, "send_scope", [projectId]);
    expect(res.version).toBe(2);

    // Deciding on the stale v1 snapshot must fail.
    await expect(
      rpc(anon, "portal_decide_scope", [token, (v1.snapshot as Json).id, "approved", "Dana", null]),
    ).rejects.toThrow(/newer version/);
  });

  it("client approves; decision is recorded immutably and the project activates", async () => {
    const v = await view(token);
    const snap = v.snapshot as Json;
    expect(snap.version).toBe(2);
    // Approver metadata comes from the request headers PostgREST exposes, not from arguments.
    await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select set_config('request.headers', $1, true)", [
        JSON.stringify({ "user-agent": "UA/1.0", "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }),
      ]);
      await tx.query("select public.portal_decide_scope($1, $2, 'approved', 'Dana Client', '')", [token, snap.id]);
    });

    const [p] = await as<Json>(db, alice, "select status, approved_at from projects where id = $1", [projectId]);
    expect(p.status).toBe("active");
    expect(p.approved_at).not.toBeNull();

    const decisions = await as<Json>(
      db,
      alice,
      "select decision, client_name, content_hash, ip_address, user_agent from scope_decisions where project_id = $1 order by created_at",
      [projectId],
    );
    expect(decisions.map((d) => d.decision)).toEqual(["rejected", "approved"]);
    expect(decisions[1].content_hash).toBe(snap.content_hash);
    expect(decisions[1].ip_address).toBe("203.0.113.9");
    expect(decisions[1].user_agent).toBe("UA/1.0");
    expect(decisions[0].ip_address).toBeNull();

    await expect(db.query("update scope_decisions set decision = 'rejected'")).rejects.toThrow(/immutable/);
    await expect(
      rpc(anon, "portal_decide_scope", [token, snap.id, "approved", "Dana", null]),
    ).rejects.toThrow(/not awaiting approval/);
  });

  it("checks revisions against the scope: in-scope until the limit, then flagged", async () => {
    const v = await view(token);
    const logo = (v.deliverables as Json[]).find((d) => d.title === "Logo")!;
    expect(logo.revisions_included).toBe(2);

    const r1 = await rpc<Json>(anon, "portal_request_revision", [token, "revision", logo.id, "Bolder type", "Dana"]);
    const r2 = await rpc<Json>(anon, "portal_request_revision", [token, "revision", logo.id, "Try navy", "Dana"]);
    const r3 = await rpc<Json>(anon, "portal_request_revision", [token, "revision", logo.id, "One more", "Dana"]);
    expect([r1.in_scope, r2.in_scope, r3.in_scope]).toEqual([true, true, false]);
    expect([r1.revision_number, r2.revision_number, r3.revision_number]).toEqual([1, 2, null]);

    const nw = await rpc<Json>(anon, "portal_request_revision", [token, "new_work", null, "Business cards too", "Dana"]);
    expect(nw.in_scope).toBe(false);

    const after = await view(token);
    const logoAfter = (after.deliverables as Json[]).find((d) => d.title === "Logo")!;
    expect(logoAfter.revisions_used).toBe(2);

    // Classification cannot be tampered with afterwards.
    await expect(db.query("update revision_requests set in_scope = true where id = $1", [r3.id])).rejects.toThrow(
      /immutable/,
    );
  });

  it("rejects revision requests for deliverables of another project", async () => {
    const other = await createProject(bob);
    const [d] = await as<Json>(db, bob, "select id from deliverables where project_id = $1 limit 1", [other.id]);
    await expect(
      rpc(anon, "portal_request_revision", [token, "revision", d.id, "sneaky", "Dana"]),
    ).rejects.toThrow(/Choose a deliverable/);
  });

  it("proposes an hourly change order with server-side pricing", async () => {
    const [rr] = await as<Json>(
      db,
      alice,
      "select id from revision_requests where project_id = $1 and kind = 'new_work'",
      [projectId],
    );
    const coId = await rpc<string>(alice, "create_change_order", [
      projectId,
      JSON.stringify({
        title: "Business cards",
        description: "Two-sided card design",
        pricing_type: "hourly",
        hours: "3.25",
        hourly_rate_cents: 8500,
        amount_cents: 1, // ignored for hourly: the database computes the price
        additional_days: 4,
        revision_request_id: rr.id,
      }),
    ]);
    const [co] = await as<Json>(db, alice, "select amount_cents, number, status from change_orders where id = $1", [
      coId,
    ]);
    expect(Number(co.amount_cents)).toBe(27625);
    expect(co.number).toBe(1);
    expect(co.status).toBe("sent");

    const [rrAfter] = await as<Json>(db, alice, "select status from revision_requests where id = $1", [rr.id]);
    expect(rrAfter.status).toBe("converted");

    await expect(db.query("update change_orders set amount_cents = 1 where id = $1", [coId])).rejects.toThrow(
      /immutable/,
    );
  });

  it("client approves the change order: budget, timeline and milestones update", async () => {
    const v = await view(token);
    const co = (v.change_orders as Json[])[0];
    await rpc(anon, "portal_decide_change_order", [token, co.id, "approved", "Dana", "Go ahead"]);

    const [p] = await as<Json>(db, alice, "select approved_extras_cents, extra_days from projects where id = $1", [
      projectId,
    ]);
    expect(Number(p.approved_extras_cents)).toBe(27625);
    expect(p.extra_days).toBe(4);

    const ms = await as<Json>(db, alice, "select title, amount_cents from milestones where project_id = $1 order by position", [
      projectId,
    ]);
    expect(ms).toHaveLength(3);
    expect(ms[2].title).toBe("Change order #1: Business cards");

    const [dec] = await as<Json>(db, alice, "select terms from change_order_decisions where change_order_id = $1", [co.id]);
    expect((dec.terms as Json).amount_cents).toBe(27625);

    await expect(
      rpc(anon, "portal_decide_change_order", [token, co.id, "rejected", "Dana", null]),
    ).rejects.toThrow(/no longer awaiting/);
  });

  it("declining a change order reopens the linked request", async () => {
    const [rr] = await as<Json>(
      db,
      alice,
      "select id from revision_requests where project_id = $1 and in_scope = false and kind = 'revision'",
      [projectId],
    );
    const coId = await rpc<string>(alice, "create_change_order", [
      projectId,
      JSON.stringify({ title: "Third logo round", pricing_type: "fixed", amount_cents: 20000, revision_request_id: rr.id }),
    ]);
    await rpc(anon, "portal_decide_change_order", [token, coId, "rejected", "Dana", "Not needed"]);
    const [after] = await as<Json>(db, alice, "select status from revision_requests where id = $1", [rr.id]);
    expect(after.status).toBe("open");
    const [p] = await as<Json>(db, alice, "select approved_extras_cents from projects where id = $1", [projectId]);
    expect(Number(p.approved_extras_cents)).toBe(27625);
  });

  it("marks milestones paid and can revert a mistaken mark", async () => {
    const ms = await as<Json>(db, alice, "select id from milestones where project_id = $1 order by position", [projectId]);
    await rpc(alice, "set_milestone_paid", [ms[0].id, true, "Bank transfer"]);
    await expect(rpc(alice, "set_milestone_paid", [ms[0].id, true, null])).rejects.toThrow(/already/);
    await rpc(alice, "set_milestone_paid", [ms[1].id, true, null]);
    await rpc(alice, "set_milestone_paid", [ms[1].id, false, null]);
    const rows = await as<Json>(db, alice, "select status from milestones where project_id = $1 order by position", [
      projectId,
    ]);
    expect(rows.map((r) => r.status)).toEqual(["paid", "pending", "pending"]);
    const v = await view(token);
    expect((v.milestones as Json[])[0].status).toBe("paid");
  });

  it("keeps a complete activity history", async () => {
    const rows = await as<Json>(db, alice, "select event from activity_log where project_id = $1 order by created_at", [
      projectId,
    ]);
    const events = rows.map((r) => r.event);
    expect(events).toEqual(
      expect.arrayContaining([
        "project.created",
        "link.created",
        "scope.sent",
        "scope.rejected",
        "scope.approved",
        "revision.requested",
        "change_order.sent",
        "change_order.approved",
        "change_order.rejected",
        "milestone.paid",
        "milestone.unpaid",
      ]),
    );
    await expect(db.query("update activity_log set summary = 'x'")).rejects.toThrow(/immutable/);
  });

  it("completes the project", async () => {
    await rpc(alice, "complete_project", [projectId]);
    const v = await view(token);
    expect((v.project as Json).status).toBe("completed");
    await expect(
      rpc(anon, "portal_request_revision", [token, "new_work", null, "late request", "Dana"]),
    ).rejects.toThrow(/in progress/);
  });

  it("rotating the link invalidates the old one", async () => {
    const fresh = await rpc<{ token: string }>(alice, "rotate_share_link", [projectId, 7]);
    expect(fresh.token).not.toBe(token);
    await expect(view(token)).rejects.toThrow(/invalid or has been revoked/);
    const v = await view(fresh.token);
    expect((v.project as Json).title).toBe(projectPayload.title);
    await rpc(alice, "revoke_share_link", [projectId]);
    await expect(view(fresh.token)).rejects.toThrow(/invalid or has been revoked/);
  });
});

describe("security", () => {
  it("anon cannot read any table directly", async () => {
    for (const table of ["projects", "clients", "profiles", "scope_snapshots", "share_links", "milestones"]) {
      await expect(as(db, anon, `select * from ${table}`)).rejects.toThrow(/permission denied/);
    }
  });

  it("users only see their own data", async () => {
    const aliceProjects = await as<Json>(db, alice, "select owner_id from projects");
    const bobProjects = await as<Json>(db, bob, "select owner_id from projects");
    expect(aliceProjects.length).toBeGreaterThan(0);
    expect(aliceProjects.every((p) => p.owner_id === alice.id)).toBe(true);
    expect(bobProjects.every((p) => p.owner_id === bob.id)).toBe(true);
    const bobsView = await as(db, bob, "select * from scope_decisions");
    expect(bobsView).toHaveLength(0);
  });

  it("authenticated users cannot write tables directly", async () => {
    const [p] = await as<Json>(db, alice, "select id from projects limit 1");
    await expect(as(db, alice, "update projects set status = 'active' where id = $1", [p.id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as(db, alice, "insert into scope_decisions (project_id, snapshot_id, decision, client_name, content_hash) values ($1, $1, 'approved', 'x', 'x')", [
        p.id,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("users cannot act on another user's project through functions", async () => {
    const [p] = await as<Json>(db, alice, "select id from projects limit 1");
    await expect(rpc(bob, "send_scope", [p.id])).rejects.toThrow(/Project not found/);
    await expect(rpc(bob, "cancel_project", [p.id])).rejects.toThrow(/Project not found/);
    await expect(rpc(bob, "rotate_share_link", [p.id, 30])).rejects.toThrow(/Project not found/);
  });

  it("anon cannot call freelancer functions or internal helpers", async () => {
    await expect(as(db, anon, "select public.send_scope(gen_random_uuid())")).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, "select public._portal_project('x', false)")).rejects.toThrow(/permission denied/);
    await expect(as(db, alice, "select public._log(gen_random_uuid(), 'system', null, 'x', 'x')")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("rejects malformed and guessed tokens", async () => {
    await expect(view("short")).rejects.toThrow(/invalid/);
    await expect(view("a".repeat(43))).rejects.toThrow(/invalid/);
    await expect(view("' or 1=1 --" + "a".repeat(32))).rejects.toThrow(/invalid/);
  });

  it("an approval cannot be submitted before the scope is sent", async () => {
    const { token } = await createProject(bob);
    await expect(
      rpc(anon, "portal_decide_scope", [token, "00000000-0000-0000-0000-000000000000", "approved", "X", null]),
    ).rejects.toThrow(/not awaiting approval/);
  });

  it("draft deletion is allowed only before sending", async () => {
    const draft = await createProject(bob);
    await rpc(bob, "delete_draft_project", [draft.id]);
    const left = await as(db, bob, "select id from projects where id = $1", [draft.id]);
    expect(left).toHaveLength(0);

    const sent = await createProject(bob);
    await rpc(bob, "send_scope", [sent.id]);
    await rpc(bob, "recall_scope", [sent.id]);
    await expect(rpc(bob, "delete_draft_project", [sent.id])).rejects.toThrow(/Only drafts/);
  });


  it("validates payloads in the database as a last line of defence", async () => {
    const bad = { ...projectPayload, deliverables: [] };
    await expect(rpc(alice, "save_project", [null, JSON.stringify(bad)])).rejects.toThrow(/between 1 and 50/);
    const badEmail = { ...projectPayload, client: { name: "X", email: "not-an-email" } };
    await expect(rpc(alice, "save_project", [null, JSON.stringify(badEmail)])).rejects.toThrow(/check constraint/);
    const badDates = { ...projectPayload, start_date: "2026-12-01", due_date: "2026-11-01" };
    await expect(rpc(alice, "save_project", [null, JSON.stringify(badDates)])).rejects.toThrow(/check constraint/);
  });
});

describe("client links", () => {
  it("are generated in the database, returned once, and stored only as a hash", async () => {
    const id = await rpc<string>(bob, "save_project", [null, JSON.stringify(projectPayload)]);
    const link = await rpc<{ token: string; expires_at: string }>(bob, "rotate_share_link", [id, 30]);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const days = (Date.parse(link.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const rows = await db.query<Json>("select * from share_links where project_id = $1", [id]);
    expect(rows.rows).toHaveLength(1);
    const stored = JSON.stringify(rows.rows[0]);
    expect(stored).not.toContain(link.token);
    expect(rows.rows[0].token_hash).toBe(createHash("sha256").update(link.token).digest("hex"));
  });

  it("owners can see link status but never the hash", async () => {
    const status = await as<Json>(db, bob, "select id, expires_at, revoked_at from share_links");
    expect(status.length).toBeGreaterThan(0);
    await expect(as(db, bob, "select token_hash from share_links")).rejects.toThrow(/permission denied/);
    await expect(as(db, alice, "select id from share_links where project_id in (select id from projects where owner_id <> $1)", [alice.id])).resolves.toHaveLength(0);
  });

  it("validity must be 1–180 days", async () => {
    const id = await rpc<string>(bob, "save_project", [null, JSON.stringify(projectPayload)]);
    await expect(rpc(bob, "rotate_share_link", [id, 0])).rejects.toThrow(/between 1 and 180/);
    await expect(rpc(bob, "rotate_share_link", [id, 365])).rejects.toThrow(/between 1 and 180/);
  });

  it("expired links stop working everywhere", async () => {
    const { id, token } = await createProject(bob);
    await rpc(bob, "send_scope", [id, 30]);
    await db.query("update share_links set created_at = now() - interval '40 days', expires_at = now() - interval '1 minute' where project_id = $1", [id]);
    await expect(view(token)).rejects.toThrow(/has expired/);
    await expect(
      rpc(anon, "portal_decide_scope", [token, "00000000-0000-0000-0000-000000000000", "approved", "X", null]),
    ).rejects.toThrow(/has expired/);
  });

  it("sending a scope creates a link only when no working link exists", async () => {
    const id = await rpc<string>(bob, "save_project", [null, JSON.stringify(projectPayload)]);
    const first = await rpc<{ link: { token: string } | null }>(bob, "send_scope", [id, 7]);
    expect(first.link?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await view(first.link!.token);
    await rpc(bob, "recall_scope", [id]);
    const second = await rpc<{ link: unknown }>(bob, "send_scope", [id, 7]);
    expect(second.link).toBeNull();
    await rpc(bob, "revoke_share_link", [id]);
    await rpc(bob, "recall_scope", [id]);
    const third = await rpc<{ link: { token: string } | null }>(bob, "send_scope", [id, 7]);
    expect(third.link?.token).toBeTruthy();
    await expect(view(first.link!.token)).rejects.toThrow(/invalid/);
  });
});

describe("abuse protection", () => {
  it("limits client requests to 10 per project per hour", async () => {
    const { id, token } = await createProject(bob);
    await rpc(bob, "send_scope", [id, 30]);
    const v = await view(token);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Dana", null]);
    for (let i = 0; i < 10; i++) {
      await rpc(anon, "portal_request_revision", [token, "new_work", null, `request ${i}`, "Dana"]);
    }
    await expect(
      rpc(anon, "portal_request_revision", [token, "new_work", null, "one too many", "Dana"]),
    ).rejects.toThrow(/Too many requests/);
  });

  it("enforces the beta allowlist at sign-up when it has entries", async () => {
    await db.query("insert into beta_allowlist (email) values ('invited@example.com')");
    await expect(createUser(db, "stranger@example.com")).rejects.toThrow(/private beta/);
    await createUser(db, "Invited@Example.com");
    await expect(as(db, alice, "select * from beta_allowlist")).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, "select * from beta_allowlist")).rejects.toThrow(/permission denied/);
    await db.query("delete from beta_allowlist");
    await createUser(db, "open@example.com");
  });
});

describe("in-app notifications", () => {
  it("counts unread client activity per owner and clears when seen", async () => {
    const carol = await createUser(db, "carol@example.com", "Carol");
    await rpc(carol, "mark_notifications_seen", []);
    const { id, token } = await createProject(carol);
    await rpc(carol, "send_scope", [id, 30]);
    expect(await rpc<number>(carol, "unread_notification_count", [])).toBe(0);

    const v = await view(token);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Dana", null]);
    await rpc(anon, "portal_request_revision", [token, "new_work", null, "extra", "Dana"]);
    expect(await rpc<number>(carol, "unread_notification_count", [])).toBe(2);
    expect(await rpc<number>(bob, "unread_notification_count", [])).toBeGreaterThanOrEqual(0);

    await rpc(carol, "mark_notifications_seen", []);
    expect(await rpc<number>(carol, "unread_notification_count", [])).toBe(0);
    await expect(as(db, anon, "select public.unread_notification_count()")).rejects.toThrow(/permission denied/);
  });

  it("health check is public and reveals nothing", async () => {
    expect(await rpc<string>(anon, "health", [])).toBe("ok");
  });
});
