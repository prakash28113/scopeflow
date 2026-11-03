/**
 * QA fix list v1, batch 1: change orders taxed like the quote, scheduling the uncovered contract,
 * SAC and place of supply, CGST+SGST vs IGST from states, archivable clients, readable money in
 * the activity log, India dates and financial-year numbering, and data corrections.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
let db: PGlite;
let owner: Role & { id: string };

async function rpcOn<T = Json>(d: PGlite, role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(d, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
const rpc = <T = Json>(role: Role, fn: string, args: unknown[]) => rpcOn<T>(db, role, fn, args);
const sql = async <T = Json>(q: string, params: unknown[] = []) => (await db.query<T>(q, params)).rows;

/** An approved rupee project: ₹35,000 + 18% GST = ₹41,300; milestones optional. */
async function approved(d: PGlite, u: Role, o: { email?: string; milestones?: Json[]; tax_bps?: number; title?: string } = {}) {
  const id = await rpcOn<string>(d, u, "save_project", [null, JSON.stringify({
    title: o.title ?? "Brand kit", currency: "INR", budget_cents: 4130000, tax_bps: o.tax_bps ?? 1800, tax_label: "GST",
    client: { name: "Asha", email: o.email ?? "asha@acme.in", company: "Acme" },
    deliverables: [{ title: "Logo", revisions_included: 2, pricing_type: "fixed", amount_cents: 3500000 }],
    milestones: o.milestones ?? [],
  })]);
  const token = ((await rpcOn<Json>(d, u, "send_scope", [id, 30])).link as Json).token as string;
  const view = await rpcOn<Json>(d, anon, "portal_view", [token]);
  await rpcOn(d, anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Asha", null]);
  return { id, token };
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "gst@example.com", "Ravi Kumar");
  await rpc(owner, "complete_onboarding", ["Ravi Kumar", "Ravi Designs", "INR"]);
  await rpc(owner, "set_invoice_details", [JSON.stringify({ gstin: "36ABCDE1234F1Z5", business_address: "Hyderabad", sac_code: "998391" })]);
});

describe("money and dates in the database", () => {
  it("formats money for messages (Indian grouping for rupees)", async () => {
    const f = async (c: number, cur: string) => (await sql<{ r: string }>("select public._money($1, $2) as r", [c, cur]))[0].r;
    expect(await f(12400000, "INR")).toBe("₹1,24,000");
    expect(await f(500000, "INR")).toBe("₹5,000");
    expect(await f(1234567891, "INR")).toBe("₹1,23,45,678.91");
    expect(await f(35000, "INR")).toBe("₹350");
    expect(await f(124050, "USD")).toBe("$1,240.50");
    expect(await f(-150000, "EUR")).toBe("-€1,500");
    expect(await f(99, "JPY")).toBe("JPY 0.99");
  });

  it("knows the Indian financial year", async () => {
    const fy = async (d: string) => (await sql<{ r: string }>("select public._financial_year($1::date) as r", [d]))[0].r;
    expect(await fy("2026-04-01")).toBe("2026-27");
    expect(await fy("2027-03-31")).toBe("2026-27");
    expect(await fy("2099-12-31")).toBe("2099-00");
  });

  it("new accounts default to rupees", async () => {
    const u = await createUser(db, "newbie@example.com", "New");
    expect((await sql("select default_currency from profiles where id = $1", [u.id]))[0]).toEqual({ default_currency: "INR" });
  });
});

describe("change orders are taxed like the quote (FX-001)", () => {
  it("adds the project's GST to the price, so contract, payment and invoice agree", async () => {
    const { id, token } = await approved(db, owner, { title: "CO tax" });
    const coId = await rpc<string>(owner, "create_change_order", [id, JSON.stringify({ title: "Brochure", pricing_type: "fixed", amount_cents: 500000, additional_days: 2 })]);
    const [co] = await sql<Json>("select subtotal_cents, tax_bps, tax_label, tax_cents, amount_cents from change_orders where id = $1", [coId]);
    expect(co).toEqual({ subtotal_cents: 500000, tax_bps: 1800, tax_label: "GST", tax_cents: 90000, amount_cents: 590000 });
    // The client sees subtotal, GST and total.
    const view = await rpc<Json>(anon, "portal_view", [token]);
    expect((view.change_orders as Json[])[0]).toMatchObject({ subtotal_cents: 500000, tax_cents: 90000, tax_bps: 1800, amount_cents: 590000 });
    await rpc(anon, "portal_decide_change_order", [token, coId, "approved", "Asha", null]);
    const [p] = await sql<Json>("select budget_cents + approved_extras_cents as total from projects where id = $1", [id]);
    expect(Number(p.total)).toBe(4130000 + 590000); // ₹41,300 + ₹5,900, all incl. GST
    const [m] = await sql<{ id: string; amount_cents: number }>("select id, amount_cents from milestones where change_order_id = $1", [coId]);
    expect(Number(m.amount_cents)).toBe(590000);
    // Invoicing it without choosing a rate uses the change order's 18%: the freelancer keeps ₹5,000 + ₹900 GST.
    const inv = await rpc<string>(owner, "create_invoice", [m.id, "{}"]);
    const [i] = await sql<Json>("select taxable_cents, tax_cents, tax_bps from client_invoices where id = $1", [inv]);
    expect(i).toEqual({ taxable_cents: 500000, tax_cents: 90000, tax_bps: 1800 });
    // The client's approval record keeps the tax terms.
    const [d] = await sql<{ terms: Json }>("select terms from change_order_decisions where change_order_id = $1", [coId]);
    expect(d.terms).toMatchObject({ subtotal_cents: 500000, tax_cents: 90000, amount_cents: 590000 });
  });

  it("lets the freelancer change or remove the tax, and locks it once sent", async () => {
    const { id } = await approved(db, owner, { title: "CO no tax" });
    const coId = await rpc<string>(owner, "create_change_order", [id, JSON.stringify({ title: "Extra hours", pricing_type: "hourly", hours: "2.5", hourly_rate_cents: 200000, tax_bps: 0 })]);
    expect((await sql<Json>("select subtotal_cents, tax_cents, amount_cents, tax_label from change_orders where id = $1", [coId]))[0]).toEqual({ subtotal_cents: 500000, tax_cents: 0, amount_cents: 500000, tax_label: null });
    await expect(rpc(owner, "create_change_order", [id, JSON.stringify({ title: "X", pricing_type: "fixed", amount_cents: 100, tax_bps: 20000 })])).rejects.toThrow(/between 0%/);
    await expect(db.exec(`update change_orders set tax_bps = 500 where id = '${coId}'`)).rejects.toThrow(/immutable/);
  });
});

describe("invoicing the part of the contract no payment covers (FX-002)", () => {
  it("adds a payment up to the uncovered amount after approval, which can then be invoiced", async () => {
    const { id } = await approved(db, owner, { title: "No milestones" });
    await expect(rpc(owner, "add_payment", [id, JSON.stringify({ amount_cents: 4130001 })])).rejects.toThrow(/Only ₹41,300 of the contract/);
    const half = await rpc<string>(owner, "add_payment", [id, JSON.stringify({ title: "Advance", amount_cents: 2065000 })]);
    const rest = await rpc<string>(owner, "add_payment", [id, JSON.stringify({ amount_cents: 2065000 })]);
    await expect(rpc(owner, "add_payment", [id, JSON.stringify({ amount_cents: 1 })])).rejects.toThrow(/Only ₹0 of the contract/);
    expect((await sql<Json>("select title from milestones where id = $1", [rest]))[0].title).toBe("Balance payment");
    const inv = await rpc<string>(owner, "create_invoice", [half, "{}"]);
    expect((await sql<Json>("select taxable_cents, tax_cents from client_invoices where id = $1", [inv]))[0]).toEqual({ taxable_cents: 1750000, tax_cents: 315000 });
    const [log] = await sql<Json>("select summary from activity_log where project_id = $1 and event = 'milestone.added' order by created_at limit 1", [id]);
    expect(log.summary).toBe("Payment added: Advance (₹20,650)");
  });

  it("only after approval, and only by the owner", async () => {
    const draft = await rpc<string>(owner, "save_project", [null, JSON.stringify({ title: "Draft", currency: "INR", budget_cents: 100000, client: { name: "B", email: "b@b.in" }, deliverables: [{ title: "X", revisions_included: 1 }], milestones: [] })]);
    await expect(rpc(owner, "add_payment", [draft, JSON.stringify({ amount_cents: 100 })])).rejects.toThrow(/once the client has approved/);
    const other = await createUser(db, "other-gst@example.com", "Other");
    const { id } = await approved(db, owner, { title: "Owned" });
    await expect(rpc(other, "add_payment", [id, JSON.stringify({ amount_cents: 100 })])).rejects.toThrow();
  });
});

describe("tax invoice details (FX-003, FX-006, FX-014, FX-017)", () => {
  it("same state: CGST+SGST; other state: IGST; SAC and place of supply printed", async () => {
    // Business in Telangana (from the GSTIN). Client in Telangana by state; another client in Karnataka by GSTIN.
    const local = await approved(db, owner, { title: "Local", email: "local@client.in", milestones: [{ title: "Full", amount_cents: 4130000 }] });
    const [{ client_id: lc }] = await sql<{ client_id: string }>("select client_id from projects where id = $1", [local.id]);
    await rpc(owner, "update_client_billing", [lc, JSON.stringify({ state_code: "36" })]);
    const away = await approved(db, owner, { title: "Away", email: "away@client.in", milestones: [{ title: "Full", amount_cents: 4130000 }] });
    const [{ client_id: ac }] = await sql<{ client_id: string }>("select client_id from projects where id = $1", [away.id]);
    await rpc(owner, "update_client_billing", [ac, JSON.stringify({ gstin: "29AAACB1234C1Z5" })]);
    expect((await sql<Json>("select state_code from clients where id = $1", [ac]))[0].state_code).toBe("29");

    const inv = async (projectId: string, p: Json = {}) => {
      const [m] = await sql<{ id: string }>("select id from milestones where project_id = $1 order by position limit 1", [projectId]);
      const id = await rpc<string>(owner, "create_invoice", [m.id, JSON.stringify(p)]);
      return (await sql<Json>("select number, tax_split, sac_code, place_of_supply, seller, buyer from client_invoices where id = $1", [id]))[0];
    };
    const a = await inv(local.id);
    expect(a).toMatchObject({ tax_split: true, sac_code: "998391", place_of_supply: "Telangana (36)" });
    expect(a.seller).toMatchObject({ state: "Telangana (36)" });
    const b = await inv(away.id);
    expect(b).toMatchObject({ tax_split: false, place_of_supply: "Karnataka (29)" });
    expect(b.buyer).toMatchObject({ state: "Karnataka (29)", gstin: "29AAACB1234C1Z5" });
    expect(String(a.number)).toMatch(/^INV-\d{4}-\d{2}-\d{3}$/);
  });

  it("the freelancer can override the tax type and SAC per invoice; bad values are refused", async () => {
    const p = await approved(db, owner, { title: "Override", email: "ov@client.in", milestones: [{ title: "One", amount_cents: 2065000 }, { title: "Two", amount_cents: 2065000 }] });
    const ms = await sql<{ id: string }>("select id from milestones where project_id = $1 order by position", [p.id]);
    await expect(rpc(owner, "create_invoice", [ms[0].id, JSON.stringify({ sac_code: "12" })])).rejects.toThrow(/SAC/);
    const id = await rpc<string>(owner, "create_invoice", [ms[0].id, JSON.stringify({ tax_split: false, sac_code: "998314" })]);
    expect((await sql<Json>("select tax_split, sac_code from client_invoices where id = $1", [id]))[0]).toEqual({ tax_split: false, sac_code: "998314" });
    await expect(rpc(owner, "set_invoice_details", [JSON.stringify({ state_code: "99" })])).rejects.toThrow(/Choose a state/);
  });

  it("restarts numbering in a new financial year, and never reuses a number", async () => {
    const u = await createUser(db, "fy@example.com", "FY");
    await rpc(u, "complete_onboarding", ["FY", "FY Studio", "INR"]);
    await db.query("update profiles set invoice_fy = '2025-26', invoice_seq = 41 where id = $1", [u.id]);
    const p = await approved(db, u, { title: "New year", email: "ny@client.in", milestones: [{ title: "One", amount_cents: 2065000 }, { title: "Two", amount_cents: 2065000 }] });
    const ms = await sql<{ id: string }>("select id from milestones where project_id = $1 order by position", [p.id]);
    const a = await rpc<string>(u, "create_invoice", [ms[0].id, "{}"]);
    expect(String((await sql<Json>("select number from client_invoices where id = $1", [a]))[0].number)).toMatch(/-001$/);
    await db.query("update profiles set invoice_seq = 0 where id = $1", [u.id]); // e.g. a counter reset
    const b = await rpc<string>(u, "create_invoice", [ms[1].id, "{}"]);
    expect(String((await sql<Json>("select number from client_invoices where id = $1", [b]))[0].number)).toMatch(/-002$/);
  });
});

describe("clients: archive and delete (FX-004)", () => {
  it("archived clients don't count toward the Free limit; unused clients can be deleted", async () => {
    const u = await createUser(db, "free-clients@example.com", "Free", { plan: "free" });
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push(await rpc<string>(u, "create_client", [JSON.stringify({ name: `C${i}`, email: `c${i}@x.in` })]));
    await expect(rpc(u, "create_client", [JSON.stringify({ name: "C6", email: "c6@x.in" })])).rejects.toThrow(/Free plan includes 5 clients/);
    await rpc(u, "delete_client", [ids[0]]);
    await rpc(u, "archive_client", [ids[1], true]);
    expect((await rpc<Json>(u, "my_plan", [])).usage).toMatchObject({ clients: 3 });
    await rpc(u, "create_client", [JSON.stringify({ name: "C6", email: "c6@x.in" })]);
    await rpc(u, "create_client", [JSON.stringify({ name: "C7", email: "c7@x.in" })]);
    // Back at 5: bringing the archived client back is refused until there's room.
    await expect(rpc(u, "archive_client", [ids[1], false])).rejects.toThrow(/Free plan includes 5 clients/);
    await expect(rpc(u, "create_client", [JSON.stringify({ name: "C2 again", email: "c2@x.in" })])).rejects.toThrow(/Free plan includes 5 clients/);
    await rpc(u, "archive_client", [ids[2], true]);
    // Adding an archived client's email again brings them back instead of duplicating.
    const back = await rpc<string>(u, "create_client", [JSON.stringify({ name: "C2 again", email: "c2@x.in" })]);
    expect(back).toBe(ids[1]);
    expect((await sql<Json>("select name, archived_at from clients where id = $1", [ids[1]]))[0]).toEqual({ name: "C2 again", archived_at: null });
  });

  it("clients with projects are kept (archive only), and active work blocks archiving", async () => {
    const { id } = await approved(db, owner, { title: "Keep", email: "keep@client.in" });
    const [{ client_id }] = await sql<{ client_id: string }>("select client_id from projects where id = $1", [id]);
    await expect(rpc(owner, "delete_client", [client_id])).rejects.toThrow(/Archive the client instead/);
    await expect(rpc(owner, "archive_client", [client_id, true])).rejects.toThrow(/project in progress/);
    await rpc(owner, "cancel_project", [id]).catch(() => undefined);
    const other = await createUser(db, "nosy@example.com", "Nosy");
    await expect(rpc(other, "delete_client", [client_id])).rejects.toThrow(/Client not found/);
  });

  it("starting a project for an archived client brings them back", async () => {
    const u = await createUser(db, "comeback@example.com", "Back");
    const c = await rpc<string>(u, "create_client", [JSON.stringify({ name: "Old", email: "old@x.in" })]);
    await rpc(u, "archive_client", [c, true]);
    await rpc(u, "save_project", [null, JSON.stringify({ title: "Return", currency: "INR", budget_cents: 1000, client: { name: "Old", email: "old@x.in" }, deliverables: [{ title: "X", revisions_included: 1 }], milestones: [] })]);
    expect((await sql<Json>("select archived_at from clients where id = $1", [c]))[0].archived_at).toBeNull();
  });
});

describe("corrections to existing data (FX-005, FX-064, FX-065, FX-067)", () => {
  it("rewrites raw minor units in part-payment entries and fixes blog text", async () => {
    const old = await createDb({ upTo: "20261114000000_blog_images.sql" });
    const u = await createUser(old, "legacy@example.com", "Prakash Mummidisetti");
    await rpcOn(old, u, "complete_onboarding", ["Prakash Mummidisetti", "Studio", "INR"]);
    const { id } = await approved(old, u, { title: "Legacy", milestones: [{ title: "Advance", amount_cents: 1000000 }] });
    const [m] = (await old.query<{ id: string }>("select id from milestones where project_id = $1", [id])).rows;
    await rpcOn(old, u, "record_payment", [m.id, JSON.stringify({ amount_cents: 500000 })]);
    expect((await old.query<Json>("select summary from activity_log where event = 'payment.partial'")).rows[0].summary).toBe("Part payment recorded: Advance (500000 of 1000000 received)");
    await old.query("insert into blog_posts (slug, title, description, category, body, status, author_name, published_at) values ('scope-creep', 'Scope creep in India', 'A short summary of at least twenty characters.', 'strategies', $1, 'published', $2, now())",
      ["Scopeflow helps. Together they are how a ₹40,000 project quietly turns into ₹40,000 for twice the work. See scopeflow.in.", "Prakash Mummidisett" + "y"]);

    await old.exec(readMigration("20261115000000_gst_invoicing.sql"));
    expect((await old.query<Json>("select summary from activity_log where event = 'payment.partial'")).rows[0].summary).toBe("Part payment recorded: Advance (₹5,000 of ₹10,000 received)");
    const [post] = (await old.query<Json>("select body, author_name from blog_posts")).rows;
    expect(post.author_name).toBe("Prakash Mummidisetti");
    expect(post.body).toBe("ScopeFlow helps. Together they are how a ₹40,000 project quietly turns into twice the work for the same ₹40,000. See scopeflow.in.");
    // New entries are written readably too.
    await rpcOn(old, u, "record_payment", [m.id, JSON.stringify({ amount_cents: 100000 })]);
    const rows = (await old.query<Json>("select summary from activity_log where event = 'payment.partial' order by created_at")).rows;
    expect(rows.at(-1)!.summary).toBe("Part payment recorded: Advance (₹6,000 of ₹10,000 received)");
  });

  it("rolls back (twice) and re-applies", async () => {
    const d = await createDb();
    const { readFileSync } = await import("node:fs");
    const down = readFileSync(new URL("../../supabase/rollback/20261115000000_gst_invoicing_down.sql", import.meta.url), "utf8");
    await d.exec(down);
    await d.exec(down);
    expect((await d.query("select 1 from information_schema.columns where table_name = 'change_orders' and column_name = 'tax_bps'")).rows).toEqual([]);
    await d.exec(readMigration("20261115000000_gst_invoicing.sql"));
  });
});
