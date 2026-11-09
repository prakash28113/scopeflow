/**
 * ScopeFlow billing: Razorpay subscriptions for paid plans.
 *
 *   GET  /billing/status    signed in → is checkout available to this account, and in which mode
 *   POST /billing/checkout  signed in → creates a Razorpay subscription for { plan, interval }
 *   POST /billing/verify    signed in → checks the payment signature Checkout returned and, if it's
 *                           genuine and Razorpay says the subscription is active, applies it right
 *                           away; otherwise answers { status: "pending" } and the webhook finishes it
 *   POST /billing/cancel    signed in → cancels the current subscription at the end of the paid period
 *   POST /billing/webhook   Razorpay → verified by HMAC-SHA256 signature, then recorded once per event
 *
 * Plain web APIs only (fetch, Request, Response, crypto.subtle), so the same code runs in Supabase
 * Edge Functions (Deno), the unit tests and the end-to-end stand-in. Razorpay's key secret and webhook
 * secret are Edge Function secrets; the database is reached with the service-role key that Supabase
 * provides to Edge Functions. Plan changes happen only in the database, from verified webhook events.
 */

export type BillingConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Emails allowed to buy in test mode (the owner's own test accounts). */
  testers: string[];
  /** Origins allowed to call checkout/cancel from a browser (the app's addresses). */
  origins: string[];
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  /** Razorpay API base; tests point it at a stand-in. */
  razorpayApi?: string;
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type User = { id: string; email: string };
type Prepared = { plan: string; plan_name: string; interval: "month" | "year"; amount_cents: number; currency: string; provider_plan_id: string | null; email: string; name: string };

const MAX_BODY = 512 * 1024;
const RAZORPAY = "https://api.razorpay.com/v1";

export const billingMode = (keyId: string): "live" | "test" | null =>
  keyId.startsWith("rzp_live_") ? "live" : keyId.startsWith("rzp_test_") ? "test" : null;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function cors(req: Request, cfg: BillingConfig): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!cfg.origins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Razorpay webhook signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
export async function verifySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !secret || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return sameHex(await hmacHex(secret, rawBody), signature.toLowerCase());
}

async function readBody(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Request too large");
  return text;
}

function serviceHeaders(cfg: BillingConfig) {
  const h: Record<string, string> = { apikey: cfg.serviceKey, "content-type": "application/json" };
  // Legacy service-role keys are JWTs and go in Authorization too; new secret keys (sb_secret_…) don't.
  if (cfg.serviceKey.startsWith("eyJ")) h.authorization = `Bearer ${cfg.serviceKey}`;
  return h;
}

async function rpc<T>(cfg: BillingConfig, f: Fetch, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await f(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: serviceHeaders(cfg), body: JSON.stringify(args) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = String(data?.code ?? "");
    // Reasons the database gives the person (not on sale, already subscribed, bad choice).
    if (code === "SF409") throw new HttpError(409, String(data.message));
    if (code === "22023") throw new HttpError(400, String(data.message));
    throw new Error(`database ${fn} failed (${res.status} ${code})`);
  }
  return data as T;
}

async function signedInUser(req: Request, cfg: BillingConfig, f: Fetch): Promise<User> {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)) throw new HttpError(401, "Please sign in again.");
  const res = await f(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.anonKey, authorization: auth } });
  if (!res.ok) throw new HttpError(401, "Please sign in again.");
  const u = await res.json();
  if (!u?.id || !u?.email) throw new HttpError(401, "Please sign in again.");
  return { id: String(u.id), email: String(u.email).toLowerCase() };
}

async function razorpay<T>(cfg: BillingConfig, f: Fetch, path: string, body?: unknown): Promise<T> {
  const res = await f(`${cfg.razorpayApi ?? RAZORPAY}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Basic ${btoa(`${cfg.keyId}:${cfg.keySecret}`)}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Razorpay's own description is safe to log; it never contains the key secret.
    console.error(`razorpay ${path} failed: ${res.status} ${data?.error?.code ?? ""} ${data?.error?.description ?? ""}`);
    throw new HttpError(502, "The payment provider didn't respond as expected. Nothing was charged. Please try again in a minute.");
  }
  return data as T;
}

const isTester = (cfg: BillingConfig, email: string) => cfg.testers.includes(email);

async function status(req: Request, cfg: BillingConfig, f: Fetch) {
  const user = await signedInUser(req, cfg, f);
  const mode = billingMode(cfg.keyId);
  return { enabled: Boolean(mode && cfg.keySecret && cfg.webhookSecret), mode, tester: isTester(cfg, user.email) };
}

async function checkout(req: Request, cfg: BillingConfig, f: Fetch) {
  const user = await signedInUser(req, cfg, f);
  const mode = billingMode(cfg.keyId)!;
  const tester = isTester(cfg, user.email);
  if (mode === "test" && !tester) throw new HttpError(409, "Paid plans aren't on sale yet.");
  let input: { plan?: unknown; interval?: unknown };
  try {
    input = JSON.parse(await readBody(req));
  } catch {
    throw new HttpError(400, "Choose a plan.");
  }
  const plan = String(input.plan ?? "");
  const interval = String(input.interval ?? "");
  const prep = await rpc<Prepared>(cfg, f, "billing_prepare_checkout", { p_owner: user.id, p_plan: plan, p_interval: interval, p_mode: mode, p_tester: tester });

  let planId = prep.provider_plan_id;
  if (!planId) {
    const label = prep.interval === "year" ? "yearly" : "monthly";
    const created = await razorpay<{ id: string }>(cfg, f, "/plans", {
      period: prep.interval === "year" ? "yearly" : "monthly",
      interval: 1,
      item: { name: `ScopeFlow ${prep.plan_name} (${label})`, amount: prep.amount_cents, currency: prep.currency },
      notes: { scopeflow_plan: prep.plan, billing_interval: prep.interval },
    });
    planId = await rpc<string>(cfg, f, "billing_save_provider_plan", {
      p_mode: mode, p_plan: prep.plan, p_interval: prep.interval, p_amount: prep.amount_cents, p_currency: prep.currency, p_provider_plan_id: created.id,
    });
  }

  const sub = await razorpay<{ id: string }>(cfg, f, "/subscriptions", {
    plan_id: planId,
    // Renews until cancelled: 10 years of monthly or yearly cycles.
    total_count: prep.interval === "year" ? 10 : 120,
    quantity: 1,
    customer_notify: 1,
    notes: { scopeflow_account: user.id, scopeflow_plan: prep.plan, billing_interval: prep.interval },
  });
  await rpc(cfg, f, "billing_record_checkout", {
    p_owner: user.id, p_subscription_id: sub.id, p_mode: mode, p_plan: prep.plan, p_interval: prep.interval, p_amount: prep.amount_cents, p_currency: prep.currency,
  });
  return {
    key_id: cfg.keyId,
    subscription_id: sub.id,
    mode,
    plan: prep.plan,
    plan_name: prep.plan_name,
    interval: prep.interval,
    amount_cents: prep.amount_cents,
    currency: prep.currency,
    email: prep.email,
    name: prep.name,
  };
}

/**
 * Checkout's success callback: Razorpay signs payment_id + "|" + subscription_id with the key secret.
 * A genuine signature means the person finished Razorpay's window, so the subscription's current
 * state is fetched from Razorpay. Only 'active' (the first charge is captured) is applied here.
 * Anything else, including 'authenticated' (mandate set up, money not yet taken), is "pending":
 * nothing is activated, and the plan switches on when Razorpay's webhook reports the captured
 * payment. A wrong or missing signature changes nothing.
 */
async function verify(req: Request, cfg: BillingConfig, f: Fetch) {
  await signedInUser(req, cfg, f);
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(await readBody(req));
  } catch {
    throw new HttpError(400, "Missing payment details.");
  }
  const paymentId = String(input.razorpay_payment_id ?? "");
  const subscriptionId = String(input.razorpay_subscription_id ?? "");
  const signature = String(input.razorpay_signature ?? "");
  if (!/^pay_\w{1,40}$/.test(paymentId) || !/^sub_\w{1,40}$/.test(subscriptionId) || !signature) throw new HttpError(400, "Missing payment details.");
  if (!/^[0-9a-f]{64}$/i.test(signature) || !sameHex(await hmacHex(cfg.keySecret, `${paymentId}|${subscriptionId}`), signature.toLowerCase())) {
    throw new HttpError(400, "We couldn't confirm this payment. If money left your account, it will show here once Razorpay confirms it.");
  }
  const sub = await razorpay<Record<string, unknown>>(cfg, f, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (sub?.status !== "active") return { verified: true, status: "pending", result: "pending" };
  const result = await rpc<string>(cfg, f, "process_razorpay_event", {
    p_event_id: `verify:${paymentId}`,
    p_mode: billingMode(cfg.keyId),
    p_event: { event: "subscription.activated", payload: { subscription: { entity: sub } } },
  });
  return { verified: true, status: result === "applied" || result === "duplicate" ? "active" : "pending", result };
}

async function cancel(req: Request, cfg: BillingConfig, f: Fetch) {
  const user = await signedInUser(req, cfg, f);
  const current = await rpc<{ subscription_id: string; mode: string; status: string; cancel_at_period_end: boolean } | null>(cfg, f, "billing_current_subscription", { p_owner: user.id });
  if (!current) throw new HttpError(409, "There's no paid plan to cancel.");
  if (current.mode !== billingMode(cfg.keyId)) throw new HttpError(409, "This plan was bought in a different payment mode. Contact support to cancel it.");
  if (current.cancel_at_period_end) return { ok: true, already: true };
  // An unpaid renewal can't wait for the end of a cycle: stop it now (access already ends with the grace period).
  const atCycleEnd = current.status === "active";
  await razorpay(cfg, f, `/subscriptions/${encodeURIComponent(current.subscription_id)}/cancel`, { cancel_at_cycle_end: atCycleEnd });
  await rpc(cfg, f, "billing_mark_cancelling", { p_owner: user.id, p_subscription_id: current.subscription_id });
  return { ok: true, at_period_end: atCycleEnd };
}

async function webhook(req: Request, cfg: BillingConfig, f: Fetch) {
  const raw = await readBody(req);
  if (!(await verifySignature(raw, req.headers.get("x-razorpay-signature"), cfg.webhookSecret))) {
    return reply(401, { error: "bad signature" });
  }
  let event: { event?: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return reply(400, { error: "bad json" });
  }
  // Subscription events, plus a captured payment (matched to an account only through its subscription).
  const type = String(event.event ?? "");
  if (!type.startsWith("subscription.") && type !== "payment.captured") return reply(200, { result: "not_subscription" });
  // Razorpay's event id makes redeliveries idempotent; the body's hash is the fallback.
  const id = req.headers.get("x-razorpay-event-id") || `sha256:${hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))}`;
  const result = await rpc<string>(cfg, f, "process_razorpay_event", { p_event_id: id.slice(0, 200), p_mode: billingMode(cfg.keyId), p_event: event });
  return reply(200, { result });
}

export async function handleBilling(req: Request, cfg: BillingConfig, f: Fetch = fetch): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const route = path.slice(path.lastIndexOf("/") + 1);
  const headers = route === "webhook" ? {} : cors(req, cfg);
  if (req.method === "OPTIONS") return new Response(null, { status: headers["access-control-allow-origin"] ? 204 : 403, headers });
  const configured = Boolean(billingMode(cfg.keyId) && cfg.keySecret && cfg.webhookSecret && cfg.serviceKey);
  try {
    if (route === "webhook" && req.method === "POST") {
      if (!configured) return reply(503, { error: "billing not configured" });
      return await webhook(req, cfg, f);
    }
    if (route === "status" && req.method === "GET") {
      return reply(200, configured ? await status(req, cfg, f) : { enabled: false, mode: null, tester: false }, headers);
    }
    if (!configured && (route === "checkout" || route === "cancel" || route === "verify")) {
      return reply(503, { error: "Payments aren't set up yet." }, headers);
    }
    if (route === "checkout" && req.method === "POST") return reply(200, await checkout(req, cfg, f), headers);
    if (route === "verify" && req.method === "POST") return reply(200, await verify(req, cfg, f), headers);
    if (route === "cancel" && req.method === "POST") return reply(200, await cancel(req, cfg, f), headers);
    return reply(404, { error: "Not found" }, headers);
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message }, headers);
    console.error(`billing ${route}: ${e instanceof Error ? e.message : String(e)}`);
    // 500 makes Razorpay retry a webhook later.
    return reply(500, { error: "Something went wrong. Nothing was charged twice; please try again." }, headers);
  }
}

/** Reads the configuration from environment variables (Supabase sets the SUPABASE_* ones). */
export function configFromEnv(get: (name: string) => string | undefined): BillingConfig {
  const list = (v: string | undefined) => String(v ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return {
    keyId: get("RAZORPAY_KEY_ID") ?? "",
    keySecret: get("RAZORPAY_KEY_SECRET") ?? "",
    webhookSecret: get("RAZORPAY_WEBHOOK_SECRET") ?? "",
    testers: list(get("BILLING_TESTERS")).map((e) => e.toLowerCase()),
    origins: list(get("APP_ORIGINS")),
    supabaseUrl: String(get("SUPABASE_URL") ?? "").replace(/\/+$/, ""),
    anonKey: get("SUPABASE_ANON_KEY") ?? "",
    serviceKey: get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  };
}
