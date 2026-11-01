/**
 * v1.2: itemised quotes (database computes the budget; line items locked into the
 * approved scope) and client profiles with private notes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";
import { quoteTotals, lineAmount } from "../../src/lib/quote";

type Json = Record<string, unknown>;
const V12 = "20261103000000_v1_2_business_tools.sql";
const DOWN = readFileSync(new URL("../../supabase/rollback/20261103000000_v1_2_business_tools_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };

const quoted = {
  title: "Brand kit",
  currency: "INR",
  budget_cents: 1, // ignored when itemised: the database computes the budget
  client: { name: "Asha", email: "asha@client.example", company: "Asha Foods" },
  deliverables: [
    { title: "Logo", revisions_included: 2, pricing_type: "fixed", amount_cents: 2500000 },
    { title: "Social templates", revisions_included: 1, pricing_type: "hourly", hours: "6.5", rate_cents: 120000 },
  ],
  milestones: [],
  discount_bps: 1000, // 10%
  tax_bps: 1800, // GST 18%
  tax_label: "GST",
};

async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0].r;
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "q@example.com", "Quoter");
  other = await createUser(db, "o@example.com", "Other");
});

describe("itemised quotes", () => {
  it("prices fixed and hourly lines, applies discount then tax, and sets the budget server-side", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(quoted)]);
    const lines = await as<Json>(db, owner, "select pricing_type, hours::text, rate_cents, amount_cents from deliverables where project_id = $1 order by position", [id]);
    expect(lines).toEqual([
      { pricing_type: "fixed", hours: null, rate_cents: null, amount_cents: 2500000 },
      { pricing_type: "hourly", hours: "6.50", rate_cents: 120000, amount_cents: 780000 },
    ]);
    // ₹25,000 + ₹7,800 = ₹32,800; −10% (₹3,280) = ₹29,520; GST 18% = ₹5,313.60 → total ₹34,833.60
    const [p] = await as<Json>(db, owner, "select budget_cents from projects where id = $1", [id]);
    expect(Number(p.budget_cents)).toBe(3483360);
    const [{ q }] = (await db.query<{ q: Json }>("select public._quote_totals($1) as q", [id])).rows;
    expect(q).toEqual({ subtotal_cents: 3280000, discount_bps: 1000, discount_cents: 328000, tax_label: "GST", tax_bps: 1800, tax_cents: 531360, total_cents: 3483360 });
  });

  it("agrees with the app's preview maths for many random quotes", async () => {
    for (let i = 0; i < 40; i++) {
      const n = 1 + (i % 4);
      const ds = Array.from({ length: n }, (_, j) =>
        j % 2
          ? { title: `L${j}`, revisions_included: 1, pricing_type: "hourly", hours: ((i * 37 + j * 13) % 9000 / 100 + 0.25).toFixed(2), rate_cents: 999 + i * 1373 }
          : { title: `L${j}`, revisions_included: 1, pricing_type: "fixed", amount_cents: 101 + i * 7919 + j * 3 },
      );
      const disc = (i * 331) % 10001;
      const tax = (i * 577) % 3001;
      const id = await rpc<string>(owner, "save_project", [null, JSON.stringify({ ...quoted, deliverables: ds, discount_bps: disc, tax_bps: tax })]);
      const [p] = await as<Json>(db, owner, "select budget_cents from projects where id = $1", [id]);
      const amounts = ds.map((d) =>
        d.pricing_type === "fixed"
          ? lineAmount({ type: "fixed", amountMinor: d.amount_cents as number })
          : lineAmount({ type: "hourly", hoursHundredths: Math.round(Number(d.hours) * 100), rateMinor: d.rate_cents as number }),
      );
      expect(Number(p.budget_cents), `case ${i}`).toBe(quoteTotals(amounts, disc, tax).total);
      await rpc(owner, "cancel_project", [id]);
    }
  });

  it("rejects partly priced deliverables and out-of-range percentages", async () => {
    const partial = { ...quoted, deliverables: [quoted.deliverables[0], { title: "Unpriced", revisions_included: 1 }] };
    await expect(rpc(owner, "save_project", [null, JSON.stringify(partial)])).rejects.toThrow(/Price every deliverable, or none/);
    await expect(rpc(owner, "save_project", [null, JSON.stringify({ ...quoted, tax_bps: 10001 })])).rejects.toThrow(/between 0% and 100%/);
    await expect(rpc(owner, "save_project", [null, JSON.stringify({ ...quoted, deliverables: [{ title: "x", revisions_included: 1, pricing_type: "barter", amount_cents: 1 }] })])).rejects.toThrow(/Unknown pricing type/);
  });

  it("unpriced projects behave exactly as before", async () => {
    const plain = { ...quoted, budget_cents: 500000, deliverables: [{ title: "Logo", revisions_included: 2 }], discount_bps: null, tax_bps: null, tax_label: null };
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(plain)]);
    const [p] = await as<Json>(db, owner, "select budget_cents from projects where id = $1", [id]);
    expect(Number(p.budget_cents)).toBe(500000);
    expect((await db.query<{ q: Json }>("select public._quote_totals($1) as q", [id])).rows[0].q).toBeNull();
  });

  it("locks the itemised quote into the scope the client approves", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(quoted)]);
    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    const v = await rpc<Json>(anon, "portal_view", [token]);
    const data = (v.snapshot as Json).data as Json;
    expect((data.pricing as Json).total_cents).toBe(3483360);
    expect((data.deliverables as Json[]).map((d) => d.amount_cents)).toEqual([2500000, 780000]);
    expect(data.budget_cents).toBe(3483360);
    await rpc(anon, "portal_decide_scope", [token, (v.snapshot as Json).id, "approved", "Asha", null]);
    await expect(db.query("update deliverables set amount_cents = 1 where project_id = $1", [id])).resolves.toBeDefined(); // raw table (superuser) …
    const after = await rpc<Json>(anon, "portal_view", [token]);
    expect((((after.snapshot as Json).data as Json).pricing as Json).total_cents).toBe(3483360); // … but the approved version is unchanged
    await expect(rpc(owner, "save_project", [id, JSON.stringify(quoted)])).rejects.toThrow(/locked/);
  });

  it("keeps discount and tax when an older app saves without them", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(quoted)]);
    const { discount_bps: _d, tax_bps: _t, tax_label: _l, ...older } = quoted;
    await rpc(owner, "save_project", [id, JSON.stringify(older)]);
    const [p] = await as<Json>(db, owner, "select discount_bps, tax_bps, tax_label, budget_cents from projects where id = $1", [id]);
    expect(p).toMatchObject({ discount_bps: 1000, tax_bps: 1800, tax_label: "GST" });
    expect(Number(p.budget_cents)).toBe(3483360);
  });
});

describe("client profiles", () => {
  it("the owner can add phone and private notes; nobody else can; clients never see notes", async () => {
    const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(quoted)]);
    const [c] = await as<Json>(db, owner, "select client_id from projects where id = $1", [id]);
    await rpc(owner, "update_client", [c.client_id, JSON.stringify({ name: "Asha R", company: "Asha Foods", phone: "+91 98765 43210", notes: "Prefers WhatsApp. Pays on time." })]);
    const [row] = await as<Json>(db, owner, "select name, phone, notes, email from clients where id = $1", [c.client_id]);
    expect(row).toEqual({ name: "Asha R", phone: "+91 98765 43210", notes: "Prefers WhatsApp. Pays on time.", email: "asha@client.example" });

    await expect(rpc(other, "update_client", [c.client_id, JSON.stringify({ name: "Hijack" })])).rejects.toThrow(/Client not found/);
    await expect(rpc(anon, "update_client", [c.client_id, JSON.stringify({ name: "x" })])).rejects.toThrow(/permission denied/);
    await expect(rpc(owner, "update_client", [c.client_id, JSON.stringify({ name: "  " })])).rejects.toThrow(/name is required/);
    await expect(as(db, owner, "update clients set notes = 'x'")).rejects.toThrow(/permission denied/);

    const token = ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
    const v = JSON.stringify(await rpc<Json>(anon, "portal_view", [token]));
    expect(v).not.toMatch(/WhatsApp|98765/);
    // Saving a project for this client keeps the profile.
    await rpc(owner, "save_project", [null, JSON.stringify({ ...quoted, title: "Second" })]);
    const [kept] = await as<Json>(db, owner, "select phone, notes from clients where id = $1", [c.client_id]);
    expect(kept.notes).toBe("Prefers WhatsApp. Pays on time.");
  });
});

describe("v1.2 migration safety", () => {
  it("re-runs cleanly, rolls back twice, and re-applies", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration(V12));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    const cols = await fresh.query<Json>("select column_name from information_schema.columns where table_name in ('deliverables','projects','clients') and column_name in ('pricing_type','amount_cents','discount_bps','tax_bps','notes','phone')");
    expect(cols.rows).toEqual([]);
    const u = await createUser(fresh, "back@example.com");
    const plain = { ...quoted, budget_cents: 4200, deliverables: [{ title: "Logo", revisions_included: 1 }] };
    await expect(as(fresh, u, "select public.save_project(null, $1) as r", [JSON.stringify(plain)])).resolves.toHaveLength(1);
    await fresh.exec(readMigration(V12));
    expect((await fresh.query<Json>("select to_regproc('public.update_client') is not null as ok")).rows[0].ok).toBe(true);
  });
});
