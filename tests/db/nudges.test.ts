/** SF-HABIT-3 (N-03): recording a payment nudge, its timeline line and its single follow-up. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const NAME = "20261125000000_payment_nudges";
let db: PGlite;
let owner: Role & { id: string };
let other: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[], on: PGlite = db): Promise<T> {
  return (await as<{ r: T }>(on, role, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))[0].r;
}
/** An approved project with one milestone, invoiced. Returns the invoice id. */
async function invoice(who: Role, title: string, on: PGlite = db) {
  const id = await rpc<string>(who, "save_project", [null, JSON.stringify({
    title, currency: "INR", budget_cents: 1000000,
    client: { name: "Asha", email: `${title.replace(/\W/g, "").toLowerCase()}@acme.in`, phone: "98765 43210" },
    deliverables: [{ title: "Logo", revisions_included: 1 }],
    milestones: [{ title: "Full payment", amount_cents: 1000000 }],
  })], on);
  const token = ((await rpc<Json>(who, "send_scope", [id, 30], on)).link as Json).token as string;
  const view = await rpc<Json>(anon, "portal_view", [token], on);
  await rpc(anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "approved", "Asha", null], on);
  const [m] = await as<{ id: string }>(on, who, "select id from milestones where project_id = $1", [id]);
  const inv = await rpc<string>(who, "create_invoice", [m.id, "{}"], on);
  const [{ number }] = await as<{ number: string }>(on, who, "select number from client_invoices where id = $1", [inv]);
  return { project: id, invoice: inv, number, token };
}
const nudge = (who: Role, inv: string, channel = "whatsapp", tone = "gentle") => rpc<Json>(who, "record_nudge", [inv, JSON.stringify({ channel, tone })]);

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com", "Priya");
  other = await createUser(db, "other@example.com", "Other");
});

describe("record_nudge", () => {
  it("an owner records a nudge and reads it; nobody else can see it or record one on it", async () => {
    const i = await invoice(owner, "Nudge one");
    const [{ today }] = (await db.query<{ today: string }>("select public._today_india()::text as today")).rows;
    const [{ plus3 }] = (await db.query<{ plus3: string }>("select (public._today_india() + 3)::text as plus3")).rows;
    expect(await nudge(owner, i.invoice)).toEqual({ ok: true, follow_up_due_on: plus3 });
    expect(await as<Json>(db, owner, "select channel, tone, invoice_id, project_id, owner_id from nudges")).toEqual([{ channel: "whatsapp", tone: "gentle", invoice_id: i.invoice, project_id: i.project, owner_id: owner.id }]);
    expect(await as(db, other, "select * from nudges")).toEqual([]);
    await expect(nudge(other, i.invoice)).rejects.toThrow(/Invoice not found/);
    await expect(as(db, anon, "select * from nudges")).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "record_nudge", [i.invoice, "{}"])).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "insert into nudges (owner_id, invoice_id, project_id, channel, tone) values ($1, $2, $3, 'email', 'firm')", [owner.id, i.invoice, i.project])).rejects.toThrow(/permission denied/);
    // The timeline says what happened, with no phone number, message or link.
    const [log] = await as<Json>(db, owner, "select actor, event, summary, metadata from activity_log where project_id = $1 and event = 'invoice.nudged'", [i.project]);
    expect(log).toEqual({ actor: "freelancer", event: "invoice.nudged", summary: `Payment nudge sent (WhatsApp, gentle) for ${i.number}`, metadata: { invoice_id: i.invoice, channel: "whatsapp", tone: "gentle" } });
    // The follow-up: three days on, India calendar, tied to the invoice.
    const [fu] = await as<Json>(db, owner, "select due_on::text as due_on, note, invoice_id, project_id, done_at from follow_ups");
    expect(fu).toMatchObject({ due_on: plus3, invoice_id: i.invoice, project_id: i.project, done_at: null });
    expect(fu.note).toMatch(new RegExp(`^Check payment for ${i.number} \\(nudged \\d{1,2} [A-Z][a-z]{2}\\)$`));
    expect(Date.parse(plus3) - Date.parse(today)).toBe(3 * 86_400_000);
  });

  it("three nudges, one open follow-up; a new one only after the first is done", async () => {
    const i = await invoice(owner, "Nudge three");
    const first = await nudge(owner, i.invoice, "whatsapp", "gentle");
    await nudge(owner, i.invoice, "email", "gentle");
    expect(await nudge(owner, i.invoice, "whatsapp", "firm")).toEqual(first);
    expect((await as(db, owner, "select 1 from nudges where invoice_id = $1", [i.invoice])).length).toBe(3);
    const open = await as<{ id: string }>(db, owner, "select id from follow_ups where invoice_id = $1 and done_at is null", [i.invoice]);
    expect(open).toHaveLength(1);
    expect((await as<Json>(db, owner, "select summary from activity_log where project_id = $1 and event = 'invoice.nudged' order by created_at", [i.project])).map((r) => r.summary)).toEqual([
      `Payment nudge sent (WhatsApp, gentle) for ${i.number}`,
      `Payment nudge sent (email, gentle) for ${i.number}`,
      `Payment nudge sent (WhatsApp, firm) for ${i.number}`,
    ]);
    await rpc(owner, "set_follow_up_done", [open[0].id, true]);
    await nudge(owner, i.invoice);
    expect((await as(db, owner, "select 1 from follow_ups where invoice_id = $1", [i.invoice])).length).toBe(2);
    expect((await as(db, owner, "select 1 from follow_ups where invoice_id = $1 and done_at is null", [i.invoice])).length).toBe(1);
  });

  it("refuses a voided invoice and anything but WhatsApp/email, gentle/firm", async () => {
    const i = await invoice(owner, "Nudge void");
    await expect(nudge(owner, i.invoice, "sms", "gentle")).rejects.toThrow(/WhatsApp or email/);
    await expect(nudge(owner, i.invoice, "email", "rude")).rejects.toThrow(/gentle or firm/);
    await expect(rpc(owner, "record_nudge", [i.invoice, "{}"])).rejects.toThrow(/WhatsApp or email/);
    await rpc(owner, "void_invoice", [i.invoice, "Wrong amount"]);
    await expect(nudge(owner, i.invoice)).rejects.toThrow(/voided/);
    expect(await as(db, owner, "select 1 from nudges where invoice_id = $1", [i.invoice])).toEqual([]);
  });

  it("at most 20 nudges per invoice per day", async () => {
    const i = await invoice(owner, "Nudge limit");
    for (let n = 0; n < 20; n++) await nudge(owner, i.invoice, n % 2 ? "email" : "whatsapp");
    await expect(nudge(owner, i.invoice)).rejects.toThrow(/20 nudges for this invoice today/);
    // Yesterday's don't count.
    await db.query("update public.nudges set created_at = now() - interval '25 hours' where invoice_id = $1", [i.invoice]);
    expect((await nudge(owner, i.invoice)).ok).toBe(true);
  });

  it("rollback then re-apply leaves the schema as it was", async () => {
    const fresh = await createDb();
    const shape = async () =>
      JSON.stringify([
        (await fresh.query("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name in ('nudges', 'follow_ups') order by 1, 2")).rows,
        (await fresh.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('nudges', 'follow_ups') order by 1")).rows,
        (await fresh.query("select policyname, cmd, qual from pg_policies where tablename = 'nudges'")).rows,
        (await fresh.query("select has_function_privilege('authenticated', 'public.record_nudge(uuid, jsonb)', 'EXECUTE') as auth, has_function_privilege('anon', 'public.record_nudge(uuid, jsonb)', 'EXECUTE') as anon")).rows,
      ]);
    const before = await shape();
    const down = readFileSync(new URL(`../../supabase/rollback/${NAME}_down.sql`, import.meta.url), "utf8");
    await fresh.exec(down);
    await fresh.exec(down);
    expect((await fresh.query("select to_regclass('public.nudges') as t")).rows).toEqual([{ t: null }]);
    expect((await fresh.query("select 1 from information_schema.columns where table_name = 'follow_ups' and column_name = 'invoice_id'")).rows).toEqual([]);
    await fresh.exec(readMigration(`${NAME}.sql`));
    await fresh.exec(readMigration(`${NAME}.sql`));
    expect(await shape()).toBe(before);
  });
});
