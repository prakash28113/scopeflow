import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { billingMode, configFromEnv, handleBilling, verifySignature, type BillingConfig } from "../../supabase/functions/billing/handler";

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const RZP = "https://rzp.test/v1";
const APP = "https://scopeflow.in";
const cfg = (o: Partial<BillingConfig> = {}): BillingConfig => ({
  keyId: "rzp_live_abc",
  keySecret: "key_secret_value",
  webhookSecret: "whsec_value",
  testers: ["owner@example.com"],
  origins: [APP],
  supabaseUrl: SUPA,
  anonKey: "anon",
  serviceKey: "eyJservice.role.key",
  razorpayApi: RZP,
  ...o,
});

type Call = { url: string; init: RequestInit; body: Record<string, unknown> | null };
function world(o: { user?: { id: string; email: string } | null; prepared?: Record<string, unknown>; dbError?: { code: string; message: string }; current?: unknown; rzpFail?: boolean; subStatus?: string } = {}) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const f = async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url === `${SUPA}/auth/v1/user`) {
      const user = o.user === undefined ? { id: "u1", email: "Buyer@Example.com" } : o.user;
      return user ? json(200, user) : json(401, { msg: "bad jwt" });
    }
    if (url.startsWith(`${SUPA}/rest/v1/rpc/`)) {
      const fn = url.slice(url.lastIndexOf("/") + 1);
      if (o.dbError && fn === "billing_prepare_checkout") return json(400, o.dbError);
      if (fn === "billing_prepare_checkout")
        return json(200, { plan: "solo", plan_name: "Solo", interval: "year", amount_cents: 499900, currency: "INR", provider_plan_id: null, email: "buyer@example.com", name: "Buyer", ...o.prepared });
      if (fn === "billing_save_provider_plan") return json(200, body!.p_provider_plan_id);
      if (fn === "billing_current_subscription") return json(200, o.current ?? null);
      if (fn === "process_razorpay_event") return json(200, "applied");
      return json(200, null);
    }
    if (url.startsWith(RZP)) {
      if (o.rzpFail) return json(400, { error: { code: "BAD_REQUEST_ERROR", description: "nope" } });
      if (url === `${RZP}/plans`) return json(200, { id: "plan_new" });
      if (url === `${RZP}/subscriptions`) return json(200, { id: "sub_new", status: "created" });
      if (url.endsWith("/cancel")) return json(200, { id: "sub_cur", status: "active" });
      if (url === `${RZP}/subscriptions/sub_new` && init.method === "GET") return json(200, { id: "sub_new", status: o.subStatus ?? "active", current_end: 1900000000 });
    }
    return json(404, { unmocked: url });
  };
  return { calls, f, rpcCalls: () => calls.filter((c) => c.url.includes("/rpc/")).map((c) => c.url.split("/").pop()) };
}
const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`${SUPA}/functions/v1/billing${path}`, { ...init, headers: { origin: APP, authorization: "Bearer aaa.bbb.ccc", ...init.headers } });
const sign = (body: string, secret = "whsec_value") => createHmac("sha256", secret).update(body).digest("hex");

describe("billing mode and config", () => {
  it("derives test or live mode from the key id", () => {
    expect(billingMode("rzp_live_x")).toBe("live");
    expect(billingMode("rzp_test_x")).toBe("test");
    expect(billingMode("")).toBeNull();
  });
  it("reads the environment", () => {
    const env: Record<string, string> = { RAZORPAY_KEY_ID: "rzp_test_1", BILLING_TESTERS: "A@x.com, b@y.com", APP_ORIGINS: "https://scopeflow.in https://www.scopeflow.in", SUPABASE_URL: `${SUPA}/` };
    const c = configFromEnv((n) => env[n]);
    expect(c).toMatchObject({ keyId: "rzp_test_1", testers: ["a@x.com", "b@y.com"], origins: ["https://scopeflow.in", "https://www.scopeflow.in"], supabaseUrl: SUPA, keySecret: "" });
  });
});

describe("webhook", () => {
  const body = JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1" } } } });

  it("verifies Razorpay's signature over the raw body", async () => {
    expect(await verifySignature(body, sign(body), "whsec_value")).toBe(true);
    expect(await verifySignature(body + " ", sign(body), "whsec_value")).toBe(false);
    expect(await verifySignature(body, sign(body, "other"), "whsec_value")).toBe(false);
    expect(await verifySignature(body, null, "whsec_value")).toBe(false);
    expect(await verifySignature(body, "zz", "whsec_value")).toBe(false);
  });

  it("rejects unsigned or forged events without touching the database", async () => {
    const w = world();
    const forged = await handleBilling(req("/webhook", { method: "POST", body, headers: { "x-razorpay-signature": sign(body, "guess") } }), cfg(), w.f);
    expect(forged.status).toBe(401);
    expect(w.calls).toHaveLength(0);
  });

  it("records a signed event once per Razorpay event id, in the key's mode", async () => {
    const w = world();
    const res = await handleBilling(req("/webhook", { method: "POST", body, headers: { "x-razorpay-signature": sign(body), "x-razorpay-event-id": "evt_123" } }), cfg(), w.f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "applied" });
    const call = w.calls.find((c) => c.url.endsWith("/rpc/process_razorpay_event"))!;
    expect(call.body).toMatchObject({ p_event_id: "evt_123", p_mode: "live", p_event: { event: "subscription.charged" } });
    expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer eyJservice.role.key");
  });

  it("falls back to the body's hash as the event id, and ignores non-subscription events", async () => {
    const w = world();
    await handleBilling(req("/webhook", { method: "POST", body, headers: { "x-razorpay-signature": sign(body) } }), cfg({ keyId: "rzp_test_x" }), w.f);
    expect(w.calls[0].body).toMatchObject({ p_event_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), p_mode: "test" });
    const other = JSON.stringify({ event: "payment.failed" });
    const r = await handleBilling(req("/webhook", { method: "POST", body: other, headers: { "x-razorpay-signature": sign(other) } }), cfg(), w.f);
    expect(await r.json()).toEqual({ result: "not_subscription" });
    expect(w.rpcCalls()).toEqual(["process_razorpay_event"]); // only the first, subscription event
    // T1-04: a captured payment is passed on; the database matches it to an account through its subscription.
    const captured = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", status: "captured" } } } });
    const c = await handleBilling(req("/webhook", { method: "POST", body: captured, headers: { "x-razorpay-signature": sign(captured) } }), cfg(), w.f);
    expect(await c.json()).toEqual({ result: "applied" });
    expect(w.calls.at(-1)!.body).toMatchObject({ p_event: { event: "payment.captured" } });
  });

  it("asks Razorpay to retry when the database fails", async () => {
    const f = async () => new Response("{}", { status: 500 });
    const r = await handleBilling(req("/webhook", { method: "POST", body, headers: { "x-razorpay-signature": sign(body) } }), cfg(), f);
    expect(r.status).toBe(500);
  });
});

describe("checkout", () => {
  const buy = (c = cfg(), w = world(), body = { plan: "solo", interval: "year" }) =>
    handleBilling(req("/checkout", { method: "POST", body: JSON.stringify(body) }), c, w.f).then(async (r) => ({ status: r.status, body: await r.json(), headers: r.headers, w }));

  it("needs a signed-in user", async () => {
    const r = await buy(cfg(), world({ user: null }));
    expect(r.status).toBe(401);
    const noToken = await handleBilling(new Request(`${SUPA}/functions/v1/billing/checkout`, { method: "POST", headers: { origin: APP } }), cfg(), world().f);
    expect(noToken.status).toBe(401);
  });

  it("creates the Razorpay plan once, then a subscription recorded against the account", async () => {
    const w = world();
    const r = await buy(cfg(), w);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ key_id: "rzp_live_abc", subscription_id: "sub_new", mode: "live", plan: "solo", plan_name: "Solo", interval: "year", amount_cents: 499900, currency: "INR", email: "buyer@example.com", name: "Buyer" });
    expect(r.headers.get("access-control-allow-origin")).toBe(APP);
    expect(w.rpcCalls()).toEqual(["billing_prepare_checkout", "billing_save_provider_plan", "billing_record_checkout"]);
    const plan = w.calls.find((c) => c.url === `${RZP}/plans`)!;
    expect(plan.body).toMatchObject({ period: "yearly", interval: 1, item: { name: "ScopeFlow Solo (yearly)", amount: 499900, currency: "INR" } });
    expect((plan.init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("rzp_live_abc:key_secret_value")}`);
    expect(w.calls.find((c) => c.url === `${RZP}/subscriptions`)!.body).toMatchObject({ plan_id: "plan_new", total_count: 10, notes: { scopeflow_account: "u1" } });
    expect(w.calls.find((c) => c.url.endsWith("/rpc/billing_record_checkout"))!.body).toMatchObject({ p_owner: "u1", p_subscription_id: "sub_new", p_mode: "live", p_plan: "solo", p_interval: "year" });
    expect(w.calls.find((c) => c.url.endsWith("/rpc/billing_prepare_checkout"))!.body).toMatchObject({ p_owner: "u1", p_tester: false });
  });

  it("reuses an existing Razorpay plan", async () => {
    const w = world({ prepared: { provider_plan_id: "plan_old", interval: "month" } });
    await buy(cfg(), w);
    expect(w.calls.some((c) => c.url === `${RZP}/plans`)).toBe(false);
    expect(w.calls.find((c) => c.url === `${RZP}/subscriptions`)!.body).toMatchObject({ plan_id: "plan_old", total_count: 120 });
  });

  it("in test mode, only testers can buy", async () => {
    const test = cfg({ keyId: "rzp_test_abc" });
    expect((await buy(test)).status).toBe(409);
    const ok = await buy(test, world({ user: { id: "u2", email: "Owner@Example.com" } }));
    expect(ok.status).toBe(200);
    expect(ok.w.calls.find((c) => c.url.endsWith("/rpc/billing_prepare_checkout"))!.body).toMatchObject({ p_mode: "test", p_tester: true });
  });

  it("passes on the database's reason, and charges nothing when Razorpay fails", async () => {
    const r = await buy(cfg(), world({ dbError: { code: "SF409", message: "Solo isn't on sale yet." } }));
    expect(r).toMatchObject({ status: 409, body: { error: "Solo isn't on sale yet." } });
    const w = world({ rzpFail: true });
    const failed = await buy(cfg(), w);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/Nothing was charged/);
    expect(w.rpcCalls()).not.toContain("billing_record_checkout");
  });

  it("is off until keys are configured", async () => {
    expect((await buy(cfg({ keySecret: "" }))).status).toBe(503);
    const s = await handleBilling(req("/status"), cfg({ webhookSecret: "" }), world().f);
    expect(await s.json()).toEqual({ enabled: false, mode: null, tester: false });
  });

  it("answers CORS preflight only for the app's own addresses", async () => {
    const ok = await handleBilling(req("/checkout", { method: "OPTIONS" }), cfg(), world().f);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(APP);
    const evil = await handleBilling(req("/checkout", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), cfg(), world().f);
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("verify (Checkout's success callback)", () => {
  const pay = (body: Record<string, unknown>, w: ReturnType<typeof world> = world()) =>
    handleBilling(req("/verify", { method: "POST", body: JSON.stringify(body) }), cfg(), w.f).then(async (r) => ({ status: r.status, body: await r.json(), w }));
  const genuine = createHmac("sha256", "key_secret_value").update("pay_abc|sub_new").digest("hex");

  it("applies the subscription from Razorpay when the signature is genuine", async () => {
    const r = await pay({ razorpay_payment_id: "pay_abc", razorpay_subscription_id: "sub_new", razorpay_signature: genuine });
    expect(r).toMatchObject({ status: 200, body: { verified: true, status: "active", result: "applied" } });
    expect(r.w.calls.find((c) => c.url.endsWith("/rpc/process_razorpay_event"))!.body).toMatchObject({
      p_event_id: "verify:pay_abc",
      p_event: { event: "subscription.activated", payload: { subscription: { entity: { id: "sub_new", status: "active" } } } },
    });
  });

  it("T1-04: 'authenticated' (mandate set up, nothing charged yet) is pending and activates nothing", async () => {
    for (const subStatus of ["authenticated", "created", "pending"]) {
      const r = await pay({ razorpay_payment_id: "pay_abc", razorpay_subscription_id: "sub_new", razorpay_signature: genuine }, world({ subStatus }));
      expect(r).toMatchObject({ status: 200, body: { verified: true, status: "pending", result: "pending" } });
      expect(r.w.rpcCalls()).toEqual([]); // no process_razorpay_event, so no activation
    }
  });

  it("changes nothing for a wrong signature or missing fields", async () => {
    const forged = await pay({ razorpay_payment_id: "pay_abc", razorpay_subscription_id: "sub_other", razorpay_signature: genuine });
    expect(forged.status).toBe(400);
    expect(forged.w.rpcCalls()).toEqual([]);
    expect(forged.w.calls.some((c) => c.url.startsWith(RZP))).toBe(false);
    expect((await pay({ razorpay_payment_id: "pay_abc" })).status).toBe(400);
    expect((await pay({ razorpay_payment_id: "pay_abc", razorpay_subscription_id: "sub_new", razorpay_signature: "0".repeat(64) })).status).toBe(400);
  });
});

describe("status and cancel", () => {
  it("tells the app whether this account can buy", async () => {
    const r = await handleBilling(req("/status"), cfg({ keyId: "rzp_test_1" }), world({ user: { id: "u", email: "owner@example.com" } }).f);
    expect(await r.json()).toEqual({ enabled: true, mode: "test", tester: true });
  });

  it("cancels at the end of the paid period and records it", async () => {
    const w = world({ current: { subscription_id: "sub_cur", mode: "live", status: "active", cancel_at_period_end: false } });
    const r = await handleBilling(req("/cancel", { method: "POST" }), cfg(), w.f);
    expect(await r.json()).toEqual({ ok: true, at_period_end: true });
    expect(w.calls.find((c) => c.url === `${RZP}/subscriptions/sub_cur/cancel`)!.body).toEqual({ cancel_at_cycle_end: true });
    expect(w.rpcCalls()).toEqual(["billing_current_subscription", "billing_mark_cancelling"]);
  });

  it("stops an unpaid renewal immediately, does nothing twice, and explains when there's nothing to cancel", async () => {
    const late = world({ current: { subscription_id: "sub_cur", mode: "live", status: "past_due", cancel_at_period_end: false } });
    await handleBilling(req("/cancel", { method: "POST" }), cfg(), late.f);
    expect(late.calls.find((c) => c.url.endsWith("/cancel"))!.body).toEqual({ cancel_at_cycle_end: false });
    const done = world({ current: { subscription_id: "sub_cur", mode: "live", status: "active", cancel_at_period_end: true } });
    expect(await (await handleBilling(req("/cancel", { method: "POST" }), cfg(), done.f)).json()).toEqual({ ok: true, already: true });
    expect(done.calls.some((c) => c.url.startsWith(RZP))).toBe(false);
    const none = await handleBilling(req("/cancel", { method: "POST" }), cfg(), world().f);
    expect(none.status).toBe(409);
  });
});
