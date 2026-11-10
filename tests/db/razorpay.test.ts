/**
 * Paid plans through Razorpay: checkout preparation, webhook processing (idempotent, matched to
 * accounts only through ScopeFlow's own checkout records), cancellation and failure handling.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { as, createDb, createUser, service, type Role } from "./harness";

type Json = Record<string, unknown>;
let db: PGlite;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261112000000_razorpay_billing_down.sql", import.meta.url), "utf8");

async function svc<T = Json>(fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, service, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
const myPlan = async (u: Role) => (await as<{ r: Json }>(db, u, "select public.my_plan() as r"))[0].r;
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

let seq = 0;
function event(type: string, sub: string, o: { status?: string; start?: number; end?: number; pay?: Json | null } = {}) {
  const start = o.start ?? now();
  return {
    entity: "event",
    event: type,
    payload: {
      subscription: { entity: { id: sub, status: o.status ?? "active", customer_id: "cust_1", current_start: start, current_end: o.end ?? start + 30 * DAY } },
      ...(o.pay === null ? {} : o.pay ? { payment: { entity: o.pay } } : {}),
    },
    created_at: now(),
  };
}
const send = (evt: Json, mode = "live", id = `evt_${++seq}`) => svc<string>("process_razorpay_event", [id, mode, JSON.stringify(evt)]);
const sell = (ids: string[]) => db.query("update plans set purchasable = (id = any($1::text[]))", [ids]);

async function checkout(u: { id: string }, sub: string, plan = "solo", interval = "month", mode = "live") {
  const prep = await svc<Json>("billing_prepare_checkout", [u.id, plan, interval, mode, false]);
  await svc("billing_record_checkout", [u.id, sub, mode, plan, interval, prep.amount_cents, prep.currency]);
  return prep;
}

beforeAll(async () => {
  db = await createDb();
});

describe("prices", () => {
  it("are in rupees: Solo ₹499/₹4,999, Studio ₹999/₹9,999, not on sale until the release enables them", async () => {
    const rows = (await db.query<Json>("select id, currency, monthly_price_cents, annual_price_cents, purchasable from plans order by position")).rows;
    expect(rows).toEqual([
      { id: "free", currency: "INR", monthly_price_cents: 0, annual_price_cents: 0, purchasable: false },
      { id: "solo", currency: "INR", monthly_price_cents: 49900, annual_price_cents: 499900, purchasable: false },
      { id: "studio", currency: "INR", monthly_price_cents: 99900, annual_price_cents: 999900, purchasable: false },
    ]);
  });
});

describe("checkout", () => {
  it("refuses plans that aren't on sale, except test-mode purchases by testers", async () => {
    await sell([]);
    const u = await createUser(db, "nosale@example.com", "N", { plan: "free" });
    await expect(svc("billing_prepare_checkout", [u.id, "solo", "month", "live", false])).rejects.toThrow(/isn't on sale/);
    await expect(svc("billing_prepare_checkout", [u.id, "solo", "month", "test", false])).rejects.toThrow(/isn't on sale/);
    expect(await svc("billing_prepare_checkout", [u.id, "solo", "month", "test", true])).toMatchObject({ amount_cents: 49900, currency: "INR" });
    await expect(svc("billing_prepare_checkout", [u.id, "free", "month", "test", true])).rejects.toThrow(/paid plan/);
    await expect(svc("billing_prepare_checkout", [u.id, "solo", "week", "test", true])).rejects.toThrow(/monthly or yearly/);
  });

  it("prices the chosen interval and reuses one Razorpay plan per plan, interval, price and mode", async () => {
    await sell(["solo"]);
    const u = await createUser(db, "buyer@example.com", "Buyer Name", { plan: "free" });
    const first = await svc<Json>("billing_prepare_checkout", [u.id, "solo", "year", "live", false]);
    expect(first).toMatchObject({ plan: "solo", plan_name: "Solo", interval: "year", amount_cents: 499900, currency: "INR", provider_plan_id: null, email: "buyer@example.com", name: "Buyer Name" });
    expect(await svc("billing_save_provider_plan", ["live", "solo", "year", 499900, "INR", "plan_live_A"])).toBe("plan_live_A");
    // A racing second creation keeps the first stored id.
    expect(await svc("billing_save_provider_plan", ["live", "solo", "year", 499900, "INR", "plan_live_B"])).toBe("plan_live_A");
    expect((await svc<Json>("billing_prepare_checkout", [u.id, "solo", "year", "live", false])).provider_plan_id).toBe("plan_live_A");
    expect((await svc<Json>("billing_prepare_checkout", [u.id, "solo", "year", "test", true])).provider_plan_id).toBeNull();
  });

  it("is service-role only", async () => {
    const u = await createUser(db, "direct@example.com", "D", { plan: "free" });
    await expect(as(db, u, "select public.billing_prepare_checkout($1, 'solo', 'month', 'live', true)", [u.id])).rejects.toThrow(/permission denied/);
    await expect(as(db, u, "select public.process_razorpay_event('e', 'live', '{}')")).rejects.toThrow(/permission denied/);
    await expect(as(db, u, "select * from billing_checkouts")).rejects.toThrow(/permission denied/);
  });
});

describe("webhook events", () => {
  it("activates the plan on payment, records the invoice, and ignores replays", async () => {
    await sell(["solo"]);
    const u = await createUser(db, "pay@example.com", "P", { plan: "free" });
    await checkout(u, "sub_pay");
    // Authorised but not yet charged: no access.
    expect(await send(event("subscription.authenticated", "sub_pay", { status: "authenticated" }))).toBe("pending");
    expect((await myPlan(u)).effective_plan).toBe("free");

    const end = now() + 30 * DAY;
    const charged = event("subscription.charged", "sub_pay", { end, pay: { id: "pay_1", invoice_id: "inv_1", amount: 49900, currency: "INR", status: "captured", created_at: now() } });
    expect(await send(charged, "live", "evt_charge_1")).toBe("applied");
    expect(await send(charged, "live", "evt_charge_1")).toBe("duplicate");
    expect(await send(event("subscription.activated", "sub_pay", { end }))).toBe("applied");
    const p = await myPlan(u);
    expect(p).toMatchObject({ plan: "solo", status: "active", effective_plan: "solo", billing_interval: "month", cancel_at_period_end: false });
    expect(Math.round(Date.parse(p.current_period_end as string) / 1000)).toBe(end);
    const inv = await as<Json>(db, u, "select provider_invoice_id, amount_cents, currency, status from invoices");
    expect(inv).toEqual([{ provider_invoice_id: "inv_1", amount_cents: 49900, currency: "INR", status: "paid" }]);
    const [{ n }] = (await db.query<Json>("select count(*)::int as n from subscription_changes where owner_id = $1 and source = 'provider'", [u.id])).rows;
    expect(n).toBe(2);
  });

  it("T1-04: 'authenticated' never switches a plan on; 'active' or a captured payment does", async () => {
    await sell(["solo"]);
    const free = async (u: Role) => expect(await myPlan(u)).toMatchObject({ plan: "free", effective_plan: "free" });
    const pay = (id: string, status = "captured") => ({ id, invoice_id: `inv_${id}`, amount: 49900, currency: "INR", status, created_at: now() });

    // Mandate set up, first charge not taken: every event shape with status 'authenticated' is pending.
    const a = await createUser(db, "auth-only@example.com", "A", { plan: "free" });
    await checkout(a, "sub_auth");
    expect(await send(event("subscription.authenticated", "sub_auth", { status: "authenticated" }))).toBe("pending");
    expect(await send(event("subscription.activated", "sub_auth", { status: "authenticated" }))).toBe("pending");
    expect(await send(event("subscription.charged", "sub_auth", { status: "authenticated" }))).toBe("pending");
    expect(await send(event("subscription.charged", "sub_auth", { status: "authenticated", pay: pay("pay_fail", "failed") }))).toBe("pending");
    await free(a);
    // The state is recorded for the account, with no plan change.
    const [{ n }] = (await db.query<Json>("select count(*)::int as n from billing_events where owner_id = $1", [a.id])).rows;
    expect(n).toBe(4);
    expect((await db.query("select 1 from subscription_changes where owner_id = $1 and source = 'provider'", [a.id])).rows).toEqual([]);
    // Then Razorpay reports it active: Solo.
    expect(await send(event("subscription.activated", "sub_auth", { status: "active" }))).toBe("applied");
    expect((await myPlan(a)).effective_plan).toBe("solo");

    // subscription.charged with a captured payment → Solo, even if the status field lags behind.
    const b = await createUser(db, "charged@example.com", "B", { plan: "free" });
    await checkout(b, "sub_charged");
    expect(await send(event("subscription.charged", "sub_charged", { status: "authenticated", pay: pay("pay_b") }))).toBe("applied");
    expect((await myPlan(b)).effective_plan).toBe("solo");
    expect(await as<Json>(db, b, "select provider_invoice_id, status from invoices")).toEqual([{ provider_invoice_id: "inv_pay_b", status: "paid" }]);

    // payment.captured naming the checkout's subscription → Solo for one billing interval; a replay does nothing.
    const c = await createUser(db, "captured@example.com", "C", { plan: "free" });
    await checkout(c, "sub_captured", "solo", "year");
    const captured = { entity: "event", event: "payment.captured", payload: { payment: { entity: { ...pay("pay_c"), subscription_id: "sub_captured" } } } };
    expect(await send(captured, "live", "evt_cap_1")).toBe("applied");
    expect(await send(captured, "live", "evt_cap_1")).toBe("duplicate");
    const p = await myPlan(c);
    expect(p).toMatchObject({ plan: "solo", effective_plan: "solo", billing_interval: "year" });
    const days = (Date.parse(p.current_period_end as string) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(367);
    expect((await db.query("select 1 from subscription_changes where owner_id = $1 and source = 'provider'", [c.id])).rows.length).toBe(1);
    // A later bare payment event keeps the running period instead of moving it.
    expect(await send({ ...captured, payload: { payment: { entity: { ...pay("pay_c"), subscription_id: "sub_captured" } } } }, "live", "evt_cap_2")).toBe("applied");
    expect((await myPlan(c)).current_period_end).toBe(p.current_period_end);
    expect((await as<Json>(db, c, "select 1 as x from invoices")).length).toBe(1);

    // Not captured, not this site's subscription, or the wrong mode: nothing.
    const d = await createUser(db, "nothing@example.com", "D", { plan: "free" });
    await checkout(d, "sub_nothing");
    expect(await send({ event: "payment.captured", payload: { payment: { entity: { ...pay("pay_d", "authorized"), subscription_id: "sub_nothing" } } } })).toBe("ignored");
    expect(await send({ event: "payment.captured", payload: { payment: { entity: pay("pay_e") } } })).toBe("unknown_subscription");
    expect(await send({ event: "payment.captured", payload: { payment: { entity: { ...pay("pay_f"), subscription_id: "sub_stranger_2" } } } })).toBe("unknown_subscription");
    expect(await send({ event: "payment.captured", payload: { payment: { entity: { ...pay("pay_g"), subscription_id: "sub_nothing" } } } }, "test")).toBe("ignored");
    expect(await send(event("subscription.activated", "sub_nothing", { status: "active" }), "test")).toBe("ignored");
    await free(d);
  });

  it("matches events only through ScopeFlow's checkout records, and keeps test and live apart", async () => {
    const u = await createUser(db, "mode@example.com", "M", { plan: "free" });
    expect(await send(event("subscription.charged", "sub_stranger"))).toBe("unknown_subscription");
    await checkout(u, "sub_test", "solo", "month", "test");
    expect(await send(event("subscription.charged", "sub_test"), "live")).toBe("ignored");
    expect((await myPlan(u)).effective_plan).toBe("free");
    expect(await send(event("subscription.charged", "sub_test"), "test")).toBe("applied");
    expect((await myPlan(u)).effective_plan).toBe("solo");
  });

  it("a failed renewal gives a short grace period; exhausted retries return the account to Free limits", async () => {
    const u = await createUser(db, "late@example.com", "L", { plan: "free" });
    await checkout(u, "sub_late");
    await send(event("subscription.charged", "sub_late"));
    expect(await send(event("subscription.pending", "sub_late", { status: "pending" }))).toBe("applied");
    const p = await myPlan(u);
    expect(p).toMatchObject({ status: "past_due", effective_plan: "solo" });
    const grace = Date.parse(p.grace_until as string);
    await send(event("subscription.pending", "sub_late", { status: "pending" })); // each retry fires again
    expect(Date.parse((await myPlan(u)).grace_until as string)).toBe(grace); // grace is not extended
    // Paying again restores the plan and clears the grace period.
    await send(event("subscription.charged", "sub_late"));
    expect(await myPlan(u)).toMatchObject({ status: "active", grace_until: null });
    await send(event("subscription.pending", "sub_late", { status: "pending" }));
    expect(await send(event("subscription.halted", "sub_late", { status: "halted" }))).toBe("applied");
    expect(await myPlan(u)).toMatchObject({ status: "expired", effective_plan: "free" });
  });

  it("a failure never grants access", async () => {
    const u = await createUser(db, "neverpaid@example.com", "N", { plan: "free" });
    await checkout(u, "sub_never");
    expect(await send(event("subscription.pending", "sub_never", { status: "pending" }))).toBe("ignored");
    expect(await send(event("subscription.halted", "sub_never", { status: "halted" }))).toBe("ignored");
    expect(await send(event("subscription.cancelled", "sub_never", { status: "cancelled" }))).toBe("ignored");
    expect((await myPlan(u)).effective_plan).toBe("free");
  });

  it("cancelling keeps paid access until the end of the period, and blocks a second subscription meanwhile", async () => {
    const u = await createUser(db, "cancel@example.com", "C", { plan: "free" });
    await checkout(u, "sub_cancel");
    const end = now() + 20 * DAY;
    await send(event("subscription.charged", "sub_cancel", { end }));
    expect(await svc<Json>("billing_current_subscription", [u.id])).toMatchObject({ subscription_id: "sub_cancel", mode: "live", status: "active" });
    await expect(svc("billing_prepare_checkout", [u.id, "solo", "year", "live", false])).rejects.toThrow(/already have a paid plan/);
    await svc("billing_mark_cancelling", [u.id, "sub_cancel"]);
    expect(await myPlan(u)).toMatchObject({ status: "active", cancel_at_period_end: true, effective_plan: "solo" });
    expect(await send(event("subscription.cancelled", "sub_cancel", { status: "cancelled", end }))).toBe("applied");
    const p = await myPlan(u);
    expect(p).toMatchObject({ status: "cancelled", effective_plan: "solo" });
    expect(Math.round(Date.parse(p.current_period_end as string) / 1000)).toBe(end);
    expect(await svc("billing_current_subscription", [u.id])).toBeNull();
  });

  it("an old subscription's events don't touch a newer one, and out-of-order events never shorten access", async () => {
    const u = await createUser(db, "order@example.com", "O", { plan: "free" });
    await checkout(u, "sub_old");
    await send(event("subscription.charged", "sub_old", { end: now() - DAY }));
    await send(event("subscription.halted", "sub_old", { status: "halted" }));
    expect((await myPlan(u)).effective_plan).toBe("free");
    await checkout(u, "sub_new", "solo", "year");
    const end = now() + 365 * DAY;
    await send(event("subscription.charged", "sub_new", { end }));
    expect(await send(event("subscription.cancelled", "sub_old", { status: "cancelled" }))).toBe("ignored");
    expect(await send(event("subscription.activated", "sub_new", { end: now() + 10 * DAY }))).toBe("applied");
    const p = await myPlan(u);
    expect(p).toMatchObject({ status: "active", billing_interval: "year", effective_plan: "solo" });
    expect(Math.round(Date.parse(p.current_period_end as string) / 1000)).toBe(end);
  });
});

describe("rollback", () => {
  it("T1-04's rollback restores the earlier event handling, and the migration re-applies", async () => {
    const name = "20261120000000_billing_activation_needs_payment";
    const down = readFileSync(new URL(`../../supabase/rollback/${name}_down.sql`, import.meta.url), "utf8");
    const up = readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
    const original = readFileSync(new URL("../../supabase/migrations/20261112000000_razorpay_billing.sql", import.meta.url), "utf8");
    const body = (sql: string) => sql.slice(sql.indexOf("create or replace function public.process_razorpay_event"), sql.indexOf("$$;", sql.indexOf("create or replace function public.process_razorpay_event")));
    expect(body(down)).toBe(body(original));
    const fresh = await createDb();
    const src = async () => (await fresh.query<{ s: string }>("select prosrc as s from pg_proc where proname = 'process_razorpay_event'")).rows[0].s;
    const now_ = await src();
    expect(now_).toContain("return 'pending'");
    await fresh.exec(down);
    await fresh.exec(down);
    expect(await src()).toContain("not in ('active', 'authenticated')");
    await fresh.exec(up);
    await fresh.exec(up);
    expect(await src()).toBe(now_);
    const grants = (await fresh.query<Json>("select has_function_privilege('anon', 'public.process_razorpay_event(text,text,jsonb)', 'EXECUTE') as anon, has_function_privilege('authenticated', 'public.process_razorpay_event(text,text,jsonb)', 'EXECUTE') as auth, has_function_privilege('service_role', 'public.process_razorpay_event(text,text,jsonb)', 'EXECUTE') as svc")).rows[0];
    expect(grants).toEqual({ anon: false, auth: false, svc: true });
  });

  it("restores dollar prices and removes the billing objects; the migration re-applies", async () => {
    const fresh = await createDb();
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    const solo = (await fresh.query<Json>("select currency, monthly_price_cents from plans where id = 'solo'")).rows[0];
    expect(solo).toEqual({ currency: "USD", monthly_price_cents: 900 });
    expect((await fresh.query("select to_regclass('public.billing_checkouts') as t")).rows).toEqual([{ t: null }]);
    await fresh.exec(readFileSync(new URL("../../supabase/migrations/20261112000000_razorpay_billing.sql", import.meta.url), "utf8"));
    expect((await fresh.query<Json>("select monthly_price_cents from plans where id = 'solo'")).rows[0]).toEqual({ monthly_price_cents: 49900 });
  });
});
