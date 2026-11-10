/** T2-13: "activated" = an approval link created. Counts for the owner of ScopeFlow, by sign-up week. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, service, type Role } from "./harness";

type Json = Record<string, unknown>;

describe("admin_activation()", () => {
  it("counts each step of getting started, and only an approval link counts as activated", async () => {
    const db = await createDb();
    const rpc = async <T = Json>(role: Role, fn: string, args: unknown[]) =>
      (await as<{ r: T }>(db, role, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))[0].r;
    const project = (who: Role, title: string) =>
      rpc<string>(who, "save_project", [null, JSON.stringify({ title, currency: "INR", budget_cents: 1000, client: { name: "Dana", email: `${title}@example.com` }, deliverables: [{ title: "Logo", revisions_included: 1 }], milestones: [] })]);
    await createUser(db, "new@example.com", "New"); // signed up, nothing else
    const drafter = await createUser(db, "draft@example.com", "Drafter");
    await project(drafter, "draft");
    const sender = await createUser(db, "send@example.com", "Sender");
    const sentId = await project(sender, "sent");
    await rpc(sender, "send_scope", [sentId, 30]);
    const logger = await createUser(db, "log@example.com", "Logger");
    const liveId = await project(logger, "live");
    const token = ((await rpc<Json>(logger, "send_scope", [liveId, 30])).link as Json).token as string;
    const view = await rpc<Json>(anon, "portal_view", [token]);
    await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null]);
    await rpc(logger, "log_client_request", [liveId, JSON.stringify({ kind: "new_work", description: "Cards too", source: "call" })]);

    const rows = (await db.query<Json>("select signup_week, signed_up::int, added_client::int, wrote_scope::int, activated::int, logged_request::int, activated_pct::float from public.admin_activation()")).rows;
    expect(rows[0]).toEqual({ signup_week: "all", signed_up: 4, added_client: 3, wrote_scope: 3, activated: 2, logged_request: 1, activated_pct: 50 });
    expect(rows).toHaveLength(2);
    expect(rows[1].signup_week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect({ ...rows[1], signup_week: "all" }).toEqual(rows[0]);
    expect(JSON.stringify(rows)).not.toContain("@");
    for (const role of [sender, anon, service]) await expect(as(db, role, "select * from public.admin_activation()")).rejects.toThrow(/permission denied/);

    const down = readFileSync(new URL("../../supabase/rollback/20261124000000_activation_down.sql", import.meta.url), "utf8");
    await db.exec(down);
    await db.exec(down);
    await db.exec(readMigration("20261124000000_activation.sql"));
    await db.exec(readMigration("20261124000000_activation.sql"));
  });
});
