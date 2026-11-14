/** SF-HABIT-3b (T-01): TDS the client withheld settles the payment, but never counts as cash. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const NAME = "20261126000000_payment_tds";
let db: PGlite;
let owner: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[], on: PGlite = db): Promise<T> {
  return (await as<{ r: T }>(on, role, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))[0].r;
}
/** An approved rupee project with one ₹10,000 payment, invoiced and due in the past. */
async function tenThousand(on: PGlite = db, who: Role = owner) {
  const id = await rpc<string>(who, "save_project", [null, JSON.stringify({
    title: `TDS ${Math.random().toString(36).slice(2, 7)}`, currency: "INR", budget_cents: 1000000,
    client: { name: "Acme", email: "accounts@acme.in" },
    deliverables: [{ title: "Website", revisions_included: 1 }],
    milestones: [{ title: "Full payment", amount_cents: 1000000 }],
  })], on);
  const token = ((await rpc<Json>(who, "send_scope", [id, 30], on)).link as Json).token as string;
  const view = await rpc<Json>(anon, "portal_view", [token], on);
  await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Acme", null], on);
  const [m] = await as<{ id: string }>(on, who, "select id from milestones where project_id = $1", [id]);
  const invoice = await rpc<string>(who, "create_invoice", [m.id, "{}"], on);
  return { project: id, milestone: m.id, invoice, token };
}
const pay = (milestone: string, amount: number, tds = 0, on: PGlite = db, who: Role = owner) =>
  rpc<string>(who, "record_payment", [milestone, JSON.stringify({ amount_cents: amount, tds_cents: tds, paid_on: "2026-11-10", method: "bank_transfer" })], on);
const ms = async (id: string, on: PGlite = db) => (await as<Json>(on, owner, "select status, paid_cents::int, tds_cents::int from milestones where id = $1", [id]))[0];

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "tds@example.com", "Ravi");
});

describe("TDS deducted by the client", () => {
  it("₹9,000 cash + ₹1,000 TDS settles a ₹10,000 payment; cash stays ₹9,000", async () => {
    const p = await tenThousand();
    const id = await pay(p.milestone, 900000, 100000);
    expect(await ms(p.milestone)).toEqual({ status: "paid", paid_cents: 1000000, tds_cents: 100000 });
    expect(await as<Json>(db, owner, "select amount_cents::int, tds_cents::int from payments where id = $1", [id])).toEqual([{ amount_cents: 900000, tds_cents: 100000 }]);
    // Cash received (what the dashboard and analytics add up) is ₹9,000.
    expect((await as<{ cash: number }>(db, owner, "select sum(amount_cents)::int as cash from payments where project_id = $1", [p.project]))[0].cash).toBe(900000);
    // The invoice is settled, so it stops being overdue: Reminders and the invoice status read milestone status.
    const [inv] = await as<Json>(db, owner, "select m.status from client_invoices i join milestones m on m.id = i.milestone_id where i.id = $1", [p.invoice]);
    expect(inv.status).toBe("paid");
    // The timeline names the TDS, with no rate or advice.
    const [log] = await as<{ summary: string }>(db, owner, "select summary from activity_log where project_id = $1 and event = 'milestone.paid'", [p.project]);
    expect(log.summary).toBe("Payment recorded: Full payment (TDS ₹1,000)");
    // The client sees the same split.
    const view = await rpc<Json>(anon, "portal_view", [p.token]);
    expect((view.milestones as Json[])[0]).toMatchObject({ status: "paid", paid_cents: 1000000, tds_cents: 100000 });
    expect((view.invoices as Json[])[0]).toMatchObject({ paid: true, paid_cents: 1000000, tds_cents: 100000 });
  });

  it("₹9,000 cash, then a TDS-only entry of ₹1,000, settles it", async () => {
    const p = await tenThousand();
    await pay(p.milestone, 900000);
    expect(await ms(p.milestone)).toEqual({ status: "pending", paid_cents: 900000, tds_cents: 0 });
    await pay(p.milestone, 0, 100000);
    expect(await ms(p.milestone)).toEqual({ status: "paid", paid_cents: 1000000, tds_cents: 100000 });
  });

  it("refuses cash + TDS above the balance, negative TDS, and nothing at all", async () => {
    const p = await tenThousand();
    await expect(pay(p.milestone, 950000, 100000)).rejects.toThrow(/more than the ₹10,000 still due/);
    await expect(pay(p.milestone, 100000, -1)).rejects.toThrow(/negative/);
    await expect(pay(p.milestone, 0, 0)).rejects.toThrow(/greater than zero/);
    await expect(as(db, owner, "update payments set tds_cents = 5")).rejects.toThrow(/permission denied/);
    // Directly, the table still refuses an empty row and negative TDS.
    await expect(db.query("insert into public.payments (owner_id, project_id, milestone_id, amount_cents, tds_cents, paid_on) values ($1, $2, $3, 0, 0, current_date)", [owner.id, p.project, p.milestone])).rejects.toThrow(/payments_amount_cents_check/);
    await expect(db.query("insert into public.payments (owner_id, project_id, milestone_id, amount_cents, tds_cents, paid_on) values ($1, $2, $3, 5, -1, current_date)", [owner.id, p.project, p.milestone])).rejects.toThrow(/payments_tds_cents_check/);
    expect(await ms(p.milestone)).toEqual({ status: "pending", paid_cents: 0, tds_cents: 0 });
  });

  it("deleting the TDS entry reopens the balance", async () => {
    const p = await tenThousand();
    await pay(p.milestone, 900000);
    const tdsOnly = await pay(p.milestone, 0, 100000);
    await rpc(owner, "delete_payment", [tdsOnly]);
    expect(await ms(p.milestone)).toEqual({ status: "pending", paid_cents: 900000, tds_cents: 0 });
  });

  it("a payment without TDS behaves exactly as before", async () => {
    const p = await tenThousand();
    await rpc(owner, "record_payment", [p.milestone, JSON.stringify({ amount_cents: 400000, paid_on: "2026-11-10" })]);
    expect(await ms(p.milestone)).toEqual({ status: "pending", paid_cents: 400000, tds_cents: 0 });
    const [log] = await as<{ summary: string }>(db, owner, "select summary from activity_log where project_id = $1 and event = 'payment.partial'", [p.project]);
    expect(log.summary).toBe("Part payment recorded: Full payment (₹4,000 of ₹10,000 received)");
  });

  it("rollback restores the earlier functions verbatim and cash-only totals; re-applying works", async () => {
    const fresh = await createDb();
    const body = (sql: string, fn: string) => {
      const a = sql.indexOf(`create or replace function public.${fn}(`);
      return sql.slice(a, sql.indexOf("\n$$;\n", a));
    };
    const down = readFileSync(new URL(`../../supabase/rollback/${NAME}_down.sql`, import.meta.url), "utf8");
    const pay0 = readFileSync(new URL("../../supabase/migrations/20261107000000_payments.sql", import.meta.url), "utf8");
    const gst = readFileSync(new URL("../../supabase/migrations/20261115000000_gst_invoicing.sql", import.meta.url), "utf8");
    expect(body(down, "_sync_milestone")).toBe(body(pay0, "_sync_milestone"));
    expect(body(down, "record_payment")).toBe(body(gst, "record_payment"));
    expect(body(down, "portal_view")).toBe(body(gst, "portal_view"));

    const u = await createUser(fresh, "tds-rollback@example.com", "Ravi");
    const p = await tenThousand(fresh, u);
    await pay(p.milestone, 900000, 0, fresh, u);
    await pay(p.milestone, 0, 100000, fresh, u);
    await fresh.exec(down);
    await fresh.exec(down);
    // Back to cash only: the TDS-only row is gone and the payment is part-paid again.
    expect((await as<Json>(fresh, u, "select status, paid_cents::int from milestones where id = $1", [p.milestone]))[0]).toEqual({ status: "pending", paid_cents: 900000 });
    expect((await fresh.query("select 1 from information_schema.columns where table_name in ('payments', 'milestones') and column_name = 'tds_cents'")).rows).toEqual([]);
    await expect(fresh.query("insert into public.payments (owner_id, project_id, milestone_id, amount_cents, paid_on) values ($1, $2, $3, 0, current_date)", [u.id, p.project, p.milestone])).rejects.toThrow(/check/);
    await fresh.exec(readMigration(`${NAME}.sql`));
    await fresh.exec(readMigration(`${NAME}.sql`));
    await pay(p.milestone, 0, 100000, fresh, u);
    expect((await as<Json>(fresh, u, "select status from milestones where id = $1", [p.milestone]))[0].status).toBe("paid");
  });
});
