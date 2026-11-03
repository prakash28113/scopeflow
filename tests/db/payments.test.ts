/** Payments done right: real dates, methods, partial payments, no overpaying, carry-over, rollback. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261107000000_payments_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[], on: PGlite = db): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(on, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
async function approved(on: PGlite = db, who: Role = owner) {
  const id = await rpc<string>(who, "save_project", [null, JSON.stringify({
    title: `Pay ${Math.random().toString(36).slice(2, 7)}`, currency: "INR", budget_cents: 3000000,
    client: { name: "Dana", email: "dana@example.com" },
    deliverables: [{ title: "Logo", revisions_included: 2 }],
    milestones: [{ title: "Advance", amount_cents: 2065000 }, { title: "Final", amount_cents: 935000 }],
  })], on);
  const token = ((await rpc<Json>(who, "send_scope", [id, 30], on)).link as Json).token as string;
  const view = await rpc<Json>(anon, "portal_view", [token], on);
  await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null], on);
  const ms = await as<{ id: string }>(on, who, "select id from milestones where project_id = $1 order by position", [id]);
  return { id, token, advance: ms[0].id, final: ms[1].id };
}
const milestone = async (id: string) => (await as<Json>(db, owner, "select status, paid_cents, paid_at, payment_note from milestones where id = $1", [id]))[0];

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "pay@example.com", "Priya");
  other = await createUser(db, "pay-other@example.com", "Other");
});

describe("recording payments", () => {
  it("records part payments with their real date and method; the milestone is paid when covered", async () => {
    const p = await approved();
    await rpc(owner, "record_payment", [p.advance, JSON.stringify({ amount_cents: 1000000, paid_on: "2026-10-20", method: "upi", reference: "UPI 4471" })]);
    expect(await milestone(p.advance)).toMatchObject({ status: "pending", paid_cents: 1000000, paid_at: null });
    await rpc(owner, "record_payment", [p.advance, JSON.stringify({ amount_cents: 1065000, paid_on: "2026-10-28", method: "bank_transfer", reference: "NEFT 99" })]);
    const m = await milestone(p.advance);
    expect(m).toMatchObject({ status: "paid", paid_cents: 2065000, payment_note: "NEFT 99" });
    // paid_at is the day the last part was received, shown as that date everywhere.
    expect(new Date(m.paid_at as string).toISOString()).toBe("2026-10-28T12:00:00.000Z");
    const log = await as<{ event: string }>(db, owner, "select event from activity_log where project_id = $1 and event in ('payment.partial','milestone.paid') order by created_at", [p.id]);
    expect(log.map((l) => l.event)).toEqual(["payment.partial", "milestone.paid"]);
    const view = await rpc<Json>(anon, "portal_view", [p.token]);
    expect((view.milestones as Json[])[0]).toMatchObject({ status: "paid", paid_cents: 2065000 });
  });

  it("refuses overpaying, future dates, bad methods, other accounts, and unapproved projects", async () => {
    const p = await approved();
    await rpc(owner, "record_payment", [p.final, JSON.stringify({ amount_cents: 900000, paid_on: "2026-10-01" })]);
    await expect(rpc(owner, "record_payment", [p.final, JSON.stringify({ amount_cents: 35001 })])).rejects.toThrow(/more than the ₹350 still due/);
    await expect(rpc(owner, "record_payment", [p.final, JSON.stringify({ amount_cents: 0 })])).rejects.toThrow(/greater than zero/);
    await expect(rpc(owner, "record_payment", [p.final, JSON.stringify({ amount_cents: 100, paid_on: "2999-01-01" })])).rejects.toThrow(/future/);
    await expect(rpc(owner, "record_payment", [p.final, JSON.stringify({ amount_cents: 100, method: "barter" })])).rejects.toThrow(/check constraint/);
    await expect(rpc(other, "record_payment", [p.final, JSON.stringify({ amount_cents: 100 })])).rejects.toThrow();
    await expect(rpc(anon, "record_payment", [p.final, JSON.stringify({ amount_cents: 100 })])).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "insert into payments (owner_id, project_id, milestone_id, amount_cents, paid_on) values ($1, $2, $3, 1, current_date)", [owner.id, p.id, p.final])).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "update milestones set paid_cents = 0 where id = $1", [p.final])).rejects.toThrow(/permission denied/);
    const draft = await rpc<string>(owner, "save_project", [null, JSON.stringify({
      title: "Draft", currency: "INR", budget_cents: 100, client: { name: "D", email: "d@example.com" },
      deliverables: [{ title: "X", revisions_included: 1 }], milestones: [{ title: "All", amount_cents: 100 }],
    })]);
    const [{ id: dm }] = await as<{ id: string }>(db, owner, "select id from milestones where project_id = $1", [draft]);
    await expect(rpc(owner, "record_payment", [dm, JSON.stringify({ amount_cents: 100 })])).rejects.toThrow(/once the client has approved/);
  });

  it("removing a payment re-opens the milestone; payments are private to their owner", async () => {
    const p = await approved();
    const id = await rpc<string>(owner, "record_payment", [p.final, JSON.stringify({ amount_cents: 935000, paid_on: "2026-10-05", method: "cash" })]);
    expect((await milestone(p.final)).status).toBe("paid");
    expect((await as<Json>(db, other, "select count(*)::int n from payments"))[0].n).toBe(0);
    await expect(rpc(other, "delete_payment", [id])).rejects.toThrow(/Payment not found/);
    await rpc(owner, "delete_payment", [id]);
    expect(await milestone(p.final)).toMatchObject({ status: "pending", paid_cents: 0, paid_at: null, payment_note: null });
  });

  it("the old Mark paid / Undo still work, now through payment records", async () => {
    const p = await approved();
    await rpc(owner, "record_payment", [p.advance, JSON.stringify({ amount_cents: 65000, paid_on: "2026-10-02" })]);
    await rpc(owner, "set_milestone_paid", [p.advance, true, "rest via UPI"]);
    expect(await milestone(p.advance)).toMatchObject({ status: "paid", paid_cents: 2065000, payment_note: "rest via UPI" });
    expect((await as<Json>(db, owner, "select count(*)::int n from payments where milestone_id = $1", [p.advance]))[0].n).toBe(2);
    await expect(rpc(owner, "set_milestone_paid", [p.advance, true, null])).rejects.toThrow(/already marked as paid/);
    await rpc(owner, "set_milestone_paid", [p.advance, false, null]);
    expect(await milestone(p.advance)).toMatchObject({ status: "pending", paid_cents: 0 });
  });

  it("the client page and invoices show how much has been paid", async () => {
    const p = await approved();
    await rpc(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: new Date().toISOString().slice(0, 10) })]);
    await rpc(owner, "record_payment", [p.advance, JSON.stringify({ amount_cents: 500000, paid_on: "2026-10-15" })]);
    const view = await rpc<Json>(anon, "portal_view", [p.token]);
    expect((view.invoices as Json[])[0]).toMatchObject({ paid: false, paid_cents: 500000 });
  });
});

describe("migration", () => {
  it("carries existing paid milestones over as payments, re-runs, and rolls back (twice)", async () => {
    const fresh = await createDb({ upTo: "20261106000000_progress_and_expenses.sql" });
    const u = await createUser(fresh, "old@example.com", "Old");
    const p = await approved(fresh, u);
    await rpc(u, "set_milestone_paid", [p.advance, true, "old NEFT"], fresh);
    await fresh.exec(readMigration("20261107000000_payments.sql"));
    await fresh.exec(readMigration("20261107000000_payments.sql"));
    const rows = (await fresh.query<Json>("select amount_cents, method, reference from public.payments")).rows;
    expect(rows).toEqual([{ amount_cents: 2065000, method: "other", reference: "old NEFT" }]);
    expect((await fresh.query<Json>("select paid_cents from public.milestones where id = $1", [p.advance])).rows[0].paid_cents).toBe(2065000);
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select to_regclass('public.payments') is null as gone")).rows[0].gone).toBe(true);
    // Paid status survives the rollback, and the old function works again.
    expect((await fresh.query<Json>("select status from public.milestones where id = $1", [p.advance])).rows[0].status).toBe("paid");
    await rpc(u, "set_milestone_paid", [p.advance, false, null], fresh);
    expect((await fresh.query<Json>("select status from public.milestones where id = $1", [p.advance])).rows[0].status).toBe("pending");
  });
});
