/** Client invoices: numbering, tax maths, immutability, ownership, the client page, rollback. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261105000000_client_invoices_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };
const today = new Date().toISOString().slice(0, 10);

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
/** An approved rupee project with two milestones; returns ids and the client token. */
async function approvedProject(title = "Menu card", tax_bps = 1800) {
  const id = await rpc<string>(owner, "save_project", [null, JSON.stringify({
    title, currency: "INR", budget_cents: 4130000, tax_bps, tax_label: "GST",
    client: { name: "Dana", email: "dana@northwind.test", company: "Northwind" },
    deliverables: [{ title: "Menu", revisions_included: 2 }],
    milestones: [{ title: "Advance", amount_cents: 2065000 }, { title: "Final", amount_cents: 2065000 }],
  })]);
  const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
  const view = await rpc<Json>(anon, "portal_view", [token]);
  await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Dana", null]);
  const ms = await as<{ id: string; title: string }>(db, owner, "select id, title from milestones where project_id = $1 order by position", [id]);
  return { id, token, advance: ms[0].id, final: ms[1].id };
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "inv@example.com", "Priya Raman");
  other = await createUser(db, "other@example.com", "Other");
  await rpc(owner, "complete_onboarding", ["Priya Raman", "Raman Studio", "INR"]);
  await rpc(owner, "set_payment_details", ["raman.studio@okicici"]);
});

describe("invoice details", () => {
  it("validates GSTIN and prefix, and only the owner can set them", async () => {
    await expect(rpc(owner, "set_invoice_details", [JSON.stringify({ gstin: "12345" })])).rejects.toThrow(/valid 15-character GSTIN/);
    await expect(rpc(owner, "set_invoice_details", [JSON.stringify({ invoice_prefix: "too-long-prefix" })])).rejects.toThrow(/up to 8 letters/);
    await rpc(owner, "set_invoice_details", [JSON.stringify({ business_address: "12 MG Road, Hyderabad 500001", gstin: "36abcde1234f1z5", invoice_prefix: "rs" })]);
    const [p] = await as<Json>(db, owner, "select business_address, gstin, invoice_prefix from profiles");
    expect(p).toEqual({ business_address: "12 MG Road, Hyderabad 500001", gstin: "36ABCDE1234F1Z5", invoice_prefix: "RS" });
    await expect(as(db, owner, "update profiles set invoice_seq = 0")).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "set_invoice_details", ["{}"])).rejects.toThrow(/permission denied/);
  });

  it("client billing details are owner-only and validated", async () => {
    const { id } = await approvedProject("Billing check");
    const [{ client_id }] = await as<{ client_id: string }>(db, owner, "select client_id from projects where id = $1", [id]);
    await rpc(owner, "update_client_billing", [client_id, JSON.stringify({ billing_address: "4 Park St, Kolkata", gstin: "19AAACN1234A1Z2" })]);
    await expect(rpc(owner, "update_client_billing", [client_id, JSON.stringify({ gstin: "bad" })])).rejects.toThrow(/valid 15-character GSTIN/);
    await expect(rpc(other, "update_client_billing", [client_id, "{}"])).rejects.toThrow(/Client not found/);
  });
});

describe("creating invoices", () => {
  it("numbers invoices per account, splits tax-inclusive totals, and snapshots seller and buyer", async () => {
    const p = await approvedProject("Numbered");
    const before = (await as<{ invoice_seq: number }>(db, owner, "select invoice_seq from profiles"))[0].invoice_seq;
    const a = await rpc<string>(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today, tax_bps: 1800, tax_label: "GST", tax_split: true, notes: "Thanks!" })]);
    const b = await rpc<string>(owner, "create_invoice", [p.final, JSON.stringify({ issue_date: today })]);
    const rows = await as<Json>(db, owner, "select * from client_invoices where id = any($1::uuid[]) order by number", [[a, b]]);
    const year = today.slice(0, 4);
    expect(rows.map((r) => r.number)).toEqual([`RS-${year}-${String(before + 1).padStart(3, "0")}`, `RS-${year}-${String(before + 2).padStart(3, "0")}`]);
    const inv = rows[0];
    // ₹20,650 incl. 18% GST → ₹17,500 taxable + ₹3,150 GST.
    expect([inv.amount_cents, inv.taxable_cents, inv.tax_cents, inv.tax_label, inv.tax_split]).toEqual([2065000, 1750000, 315000, "GST", true]);
    expect(rows[1].tax_bps).toBe(0);
    expect(rows[1].tax_label).toBeNull();
    expect(rows[1].taxable_cents).toBe(2065000);
    expect(inv.seller).toMatchObject({ name: "Raman Studio", person: "Priya Raman", gstin: "36ABCDE1234F1Z5", upi_id: "raman.studio@okicici", address: "12 MG Road, Hyderabad 500001" });
    expect(inv.buyer).toMatchObject({ name: "Dana", company: "Northwind", email: "dana@northwind.test" });
    expect(inv.description).toBe("Numbered — Advance");
    // Later profile changes never alter an issued invoice.
    await rpc(owner, "set_invoice_details", [JSON.stringify({ business_address: "New address", gstin: "", invoice_prefix: "RS" })]);
    expect((await as<Json>(db, owner, "select seller from client_invoices where id = $1", [a]))[0].seller).toMatchObject({ address: "12 MG Road, Hyderabad 500001" });
    await rpc(owner, "set_invoice_details", [JSON.stringify({ business_address: "12 MG Road, Hyderabad 500001", gstin: "36ABCDE1234F1Z5", invoice_prefix: "RS" })]);
  });

  it("rounds the tax split exactly for awkward amounts", async () => {
    for (const [amount, bps] of [[100001, 1800], [99999, 500], [1, 1800], [123457, 2800]]) {
      const { rows } = await db.query<{ t: number }>(`select round(${amount} * 10000.0 / (10000 + ${bps}))::bigint as t`);
      expect(Number(rows[0].t) + (amount - Number(rows[0].t))).toBe(amount);
    }
  });

  it("one live invoice per payment; voiding keeps the number and allows a new one", async () => {
    const p = await approvedProject("Void flow");
    const a = await rpc<string>(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today })]);
    await expect(rpc(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today })])).rejects.toThrow(/already has an invoice/);
    await rpc(owner, "void_invoice", [a, "Wrong client name"]);
    await expect(rpc(owner, "void_invoice", [a, null])).rejects.toThrow(/already void/);
    const b = await rpc<string>(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today })]);
    const nums = await as<{ number: string; voided_at: string | null }>(db, owner, "select number, voided_at from client_invoices where id = any($1::uuid[]) order by number", [[a, b]]);
    expect(nums[0].voided_at).not.toBeNull();
    expect(nums[0].number).not.toBe(nums[1].number);
  });

  it("refuses invoices before approval, for other accounts' payments, and with bad dates", async () => {
    const draft = await rpc<string>(owner, "save_project", [null, JSON.stringify({
      title: "Draft", currency: "INR", budget_cents: 1000, client: { name: "Dana", email: "dana@northwind.test" },
      deliverables: [{ title: "X", revisions_included: 1 }], milestones: [{ title: "All", amount_cents: 1000 }],
    })]);
    const [{ id: m }] = await as<{ id: string }>(db, owner, "select id from milestones where project_id = $1", [draft]);
    await expect(rpc(owner, "create_invoice", [m, "{}"])).rejects.toThrow(/once the client has approved/);
    const p = await approvedProject("Dates");
    await expect(rpc(other, "create_invoice", [p.advance, "{}"])).rejects.toThrow(/Payment not found/);
    await expect(rpc(anon, "create_invoice", [p.advance, "{}"])).rejects.toThrow(/permission denied/);
    await expect(rpc(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: "2020-01-01" })])).rejects.toThrow(/must be today/);
    await expect(rpc(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today, due_date: "2020-01-01" })])).rejects.toThrow(/due date/);
    await expect(rpc(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today, tax_bps: 20000 })])).rejects.toThrow(/Tax rate/);
  });
});

describe("issued invoices are locked", () => {
  it("can't be edited or deleted, even by the database owner; only voided", async () => {
    const p = await approvedProject("Locked");
    const id = await rpc<string>(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today })]);
    await expect(as(db, owner, "update client_invoices set amount_cents = 1 where id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "delete from client_invoices where id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(db.query("update public.client_invoices set amount_cents = 1, taxable_cents = 1, tax_cents = 0 where id = $1", [id])).rejects.toThrow(/cannot be changed/);
    await expect(db.query("delete from public.client_invoices where id = $1", [id])).rejects.toThrow(/void them instead/);
    await expect(db.query("update public.client_invoices set voided_at = now(), notes = 'sneaky' where id = $1", [id])).rejects.toThrow(/cannot be changed/);
  });

  it("each account sees only its own invoices", async () => {
    const mine = await as<Json>(db, owner, "select count(*)::int n from client_invoices");
    const theirs = await as<Json>(db, other, "select count(*)::int n from client_invoices");
    expect(Number(mine[0].n)).toBeGreaterThan(0);
    expect(theirs[0].n).toBe(0);
    await expect(as(db, anon, "select * from client_invoices")).rejects.toThrow(/permission denied/);
  });
});

describe("the client page", () => {
  it("lists live invoices with paid status, and hides void ones", async () => {
    const p = await approvedProject("Portal");
    const a = await rpc<string>(owner, "create_invoice", [p.advance, JSON.stringify({ issue_date: today, tax_bps: 1800, tax_label: "GST" })]);
    const b = await rpc<string>(owner, "create_invoice", [p.final, JSON.stringify({ issue_date: today })]);
    await rpc(owner, "void_invoice", [b, null]);
    await rpc(owner, "set_milestone_paid", [p.advance, true, "UPI ref 123"]);
    const view = await rpc<Json>(anon, "portal_view", [p.token]);
    const invoices = view.invoices as Json[];
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ id: a, paid: true, amount_cents: 2065000, tax_cents: 315000 });
    expect((view.milestones as Json[]).map((m) => m.invoice_number)).toEqual([invoices[0].number, null]);
    expect(JSON.stringify(view)).not.toMatch(/inv@example\.com.*owner_id|"owner_id"/);
  });

  it("another project's link never shows these invoices", async () => {
    const p = await approvedProject("Separate");
    const view = await rpc<Json>(anon, "portal_view", [p.token]);
    expect(view.invoices).toEqual([]);
  });
});

describe("migration", () => {
  it("re-runs and rolls back (twice) cleanly, restoring the previous client page", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration("20261105000000_client_invoices.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    const q = async (sql: string) => (await fresh.query<Json>(sql)).rows[0];
    expect((await q("select to_regclass('public.client_invoices') is null as gone")).gone).toBe(true);
    expect((await q("select count(*)::int n from information_schema.columns where table_name = 'profiles' and column_name in ('gstin','invoice_seq')")).n).toBe(0);
    expect((await q("select pg_get_functiondef('public.portal_view(text)'::regprocedure) like '%client_invoices%' as has")).has).toBe(false);
    await fresh.exec(readMigration("20261105000000_client_invoices.sql"));
    expect((await q("select to_regproc('public.create_invoice') is not null as ok")).ok).toBe(true);
  });
});
