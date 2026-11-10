// Usage: POSTGREST_BIN=/path/to/postgrest node tests/e2e/stack.mjs
// Local Supabase stand-in for end-to-end testing:
//   PGlite (real Postgres 17) over the wire protocol -> real PostgREST 12 -> gateway at :54321
//   plus a minimal GoTrue-compatible auth shim (password grant, /user, signup, refresh, logout,
//   password recovery). Recovery "emails" are kept in memory and read by the walkthrough via
//   GET /auth/v1/__test/recovery?email=…, /__test/plan?email=…&plan=… and /__test/purchasable?plan=…&on=1|0 (local test
//   stand-ins only; never part of the app).
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import { handleBilling } from "../../supabase/functions/billing/handler.ts";
import { handleBlogApi } from "../../supabase/functions/blog/handler.ts";
import { handleNotify } from "../../supabase/functions/notify/handler.ts";

const PROJECT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const SECRET = "e2e-jwt-secret-that-is-at-least-32-characters-long";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function sign(payload) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64(payload);
  const s = createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = (token || "").split(".");
  if (!s) return null;
  if (createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}
const now = () => Math.floor(Date.now() / 1000);
const ANON = sign({ role: "anon", iss: "e2e", exp: now() + 86400 * 30 });
const SERVICE = sign({ role: "service_role", iss: "e2e", exp: now() + 86400 * 30 });
writeFileSync(new URL("./keys.json", import.meta.url), JSON.stringify({ anon: ANON, service: SERVICE }));

// ---------------------------------------------------------------- database
const db = new PGlite();
const stub = readFileSync(`${PROJECT}/tests/db/supabase-stub.sql`, "utf8");
await db.exec(stub);
for (const f of readdirSync(`${PROJECT}/supabase/migrations`).sort()) {
  await db.exec(readFileSync(`${PROJECT}/supabase/migrations/${f}`, "utf8"));
}
await db.exec(`
  insert into public.blog_authors (email) values ('writer@studio.test');
  -- Stand-in only: lets the auth shim run its queries through PostgREST's single connection, so they never
  -- interleave with (or inherit the role of) a PostgREST transaction on the shared PGlite session.
  create or replace function public.e2e_auth_query(p_sql text) returns jsonb
  language plpgsql security definer set search_path = '' as $fn$
  declare r jsonb;
  begin
    execute format('with t as (%s) select coalesce(jsonb_agg(t), ''[]''::jsonb) from t', p_sql) into r;
    return r;
  end $fn$;
  revoke all on function public.e2e_auth_query(text) from public, anon, authenticated;
  grant execute on function public.e2e_auth_query(text) to service_role;
  alter table auth.users add column if not exists encrypted_password text;
  create role authenticator login noinherit;
  grant anon, authenticated, service_role to authenticator;
`);
const sock = new PGLiteSocketServer({ db, port: 54329, host: "127.0.0.1" });
await sock.start();
console.log("postgres on :54329");

// ---------------------------------------------------------------- postgrest
writeFileSync(
  new URL("./postgrest.conf", import.meta.url),
  `db-uri = "postgres://authenticator@127.0.0.1:54329/postgres?sslmode=disable"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 1
db-channel-enabled = false
db-prepared-statements = false
jwt-secret = "${SECRET}"
server-port = 3001
log-level = "error"
`,
);
const pgrst = spawn(process.env.POSTGREST_BIN || "postgrest", [new URL("./postgrest.conf", import.meta.url).pathname], {
  stdio: "inherit",
});
process.on("exit", () => pgrst.kill());

// ---------------------------------------------------------------- auth shim
// Auth queries go through PostgREST (as service role), so they are serialized with the app's own
// requests on the single database session. Parameters are inlined as quoted literals (test stand-in only).
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
async function q(sql, params = []) {
  const text = sql.replace(/\$(\d+)/g, (_, i) => lit(params[Number(i) - 1]));
  const res = await fetch("http://127.0.0.1:3001/rpc/e2e_auth_query", {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify({ p_sql: text }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`auth shim query failed: ${JSON.stringify(body)}`);
  return { rows: body };
}

function userObj(u) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: u.raw_user_meta_data ?? {},
    app_metadata: { provider: "email" },
    created_at: new Date().toISOString(),
  };
}
function session(u) {
  const exp = now() + 3600;
  return {
    access_token: sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, exp }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `r_${u.id}_${randomUUID()}`,
    user: userObj(u),
  };
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString();
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(obj));
}

const outbox = new Map();
// Test switches that mirror the Supabase dashboard: "Confirm email" and CAPTCHA protection.
// GET /auth/v1/__test/settings?confirm=1|0&captcha=1|0. Both start off, like production today.
const authSettings = { confirm: false, captcha: false };
const unconfirmed = new Set();
const confirmOutbox = new Map(); // email -> { link, sent }
const captchaLog = []; // { path, token } for every auth call that can carry a CAPTCHA token
/** Like Supabase with CAPTCHA on: password sign-in, sign-up, resend and recover need a token. */
function captchaRefused(path, b, res) {
  const token = b?.gotrue_meta_security?.captcha_token ?? null;
  captchaLog.push({ path, token });
  if (!authSettings.captcha || token) return false;
  json(res, 400, { code: 400, error_code: "captcha_failed", msg: "captcha verification process failed" });
  return true;
}
function sendConfirm(u, redirectTo) {
  const sn = session(u);
  const back = redirectTo || "http://localhost:3000/auth/callback";
  const prev = confirmOutbox.get(u.email);
  confirmOutbox.set(u.email, {
    link: `${back}#access_token=${sn.access_token}&expires_at=${sn.expires_at}&expires_in=3600&refresh_token=${sn.refresh_token}&token_type=bearer&type=signup`,
    sent: (prev?.sent ?? 0) + 1,
  });
}
async function auth(req, res, url) {
  const path = url.pathname.replace("/auth/v1", "");
  if (path === "/__test/settings" && req.method === "GET") {
    for (const k of ["confirm", "captcha"]) if (url.searchParams.has(k)) authSettings[k] = url.searchParams.get(k) === "1";
    return json(res, 200, authSettings);
  }
  if (path === "/__test/confirmation" && req.method === "GET") {
    const mail = confirmOutbox.get(url.searchParams.get("email"));
    return mail ? json(res, 200, mail) : json(res, 404, { msg: "no confirmation email" });
  }
  if (path === "/__test/captcha-log" && req.method === "GET") {
    const log = captchaLog.splice(0);
    return json(res, 200, { log });
  }
  if (path === "/signup" && req.method === "POST") {
    const b = await body(req);
    if (captchaRefused(path, b, res)) return;
    const exists = await q("select * from auth.users where email = $1", [b.email]);
    if (authSettings.confirm) {
      // Like Supabase with "Confirm email" on: no session, and an existing address gets a
      // look-alike user back (no error, no email) so the form can't be used to find accounts.
      if (exists.rows.length) return json(res, 200, { ...userObj({ ...exists.rows[0], id: randomUUID() }), email_confirmed_at: undefined, identities: [] });
      const r = await q("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *", [
        b.email, b.password, JSON.stringify(b.data ?? {}),
      ]);
      unconfirmed.add(b.email);
      sendConfirm(r.rows[0], url.searchParams.get("redirect_to"));
      return json(res, 200, { ...userObj(r.rows[0]), email_confirmed_at: undefined, confirmation_sent_at: new Date().toISOString() });
    }
    if (exists.rows.length) return json(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    const r = await q("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *", [
      b.email, b.password, JSON.stringify(b.data ?? {}),
    ]);
    return json(res, 200, session(r.rows[0]));
  }
  if (path === "/resend" && req.method === "POST") {
    const b = await body(req);
    if (captchaRefused(path, b, res)) return;
    const r = await q("select * from auth.users where email = $1", [String(b.email ?? "").toLowerCase()]);
    if (b.type === "signup" && r.rows.length && unconfirmed.has(r.rows[0].email)) sendConfirm(r.rows[0], url.searchParams.get("redirect_to"));
    return json(res, 200, {}); // same answer for every address
  }
  if (path === "/token") {
    const grant = url.searchParams.get("grant_type");
    const b = await body(req);
    if (grant === "password") {
      if (captchaRefused("/token?grant_type=password", b, res)) return;
      const r = await q("select * from auth.users where email = $1 and encrypted_password = $2", [b.email, b.password]);
      if (!r.rows.length) return json(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (unconfirmed.has(r.rows[0].email)) return json(res, 400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return json(res, 200, session(r.rows[0]));
    }
    if (grant === "id_token") {
      // Test stand-in for Sign in with Google: accepts only "test-google:<email>:<name>" with a nonce.
      const m = /^test-google:([^:]+):(.+)$/.exec(String(b.id_token ?? ""));
      if (b.provider !== "google" || !m || !b.nonce) return json(res, 400, { code: 400, error_code: "bad_oauth_callback", msg: "Bad ID token" });
      const email = m[1].toLowerCase();
      let r = await q("select * from auth.users where email = $1", [email]);
      if (!r.rows.length) {
        r = await q("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *", [
          email, `google-only-${randomUUID()}`, JSON.stringify({ full_name: m[2], name: m[2], email_verified: true }),
        ]);
      }
      return json(res, 200, session(r.rows[0]));
    }
    if (grant === "refresh_token") {
      const id = String(b.refresh_token || "").split("_")[1];
      const r = await q("select * from auth.users where id::text = $1", [id]);
      if (!r.rows.length) return json(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return json(res, 200, session(r.rows[0]));
    }
  }
  if (path === "/user" && req.method === "GET") {
    const claims = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!claims?.sub) return json(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    const r = await q("select * from auth.users where id = $1", [claims.sub]);
    if (!r.rows.length) return json(res, 404, { code: 404, msg: "User not found" });
    unconfirmed.delete(r.rows[0].email); // a session exists only after the emailed link was opened
    return json(res, 200, userObj(r.rows[0]));
  }
  if (path === "/logout") { res.writeHead(204, CORS); return res.end(); }
  if (path === "/recover" && req.method === "POST") {
    const b = await body(req);
    if (captchaRefused(path, b, res)) return;
    const r = await q("select * from auth.users where email = $1", [String(b.email ?? "").toLowerCase()]);
    const back = url.searchParams.get("redirect_to");
    if (r.rows.length && back) {
      const s = session(r.rows[0]);
      outbox.set(r.rows[0].email, `${back}#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=3600&refresh_token=${s.refresh_token}&token_type=bearer&type=recovery`);
    }
    return json(res, 200, {}); // same answer whether or not the account exists, like Supabase
  }
  if (path === "/__test/recovery" && req.method === "GET") {
    const link = outbox.get(url.searchParams.get("email"));
    outbox.delete(url.searchParams.get("email"));
    return link ? json(res, 200, { link }) : json(res, 404, { msg: "no recovery email" });
  }
  // Local test stand-in only: put an account on a plan, like the SQL editor's admin_set_plan.
  if (path === "/__test/razorpay-status" && req.method === "GET") {
    rzpStatus = url.searchParams.get("status") === "authenticated" ? "authenticated" : "active";
    return json(res, 200, { status: rzpStatus });
  }
  if (path === "/__test/reset-rate-limits" && req.method === "GET") {
    // The walkthrough ends by locking this machine's IP out of client links; later scripts start clean.
    await q("delete from public.portal_rate_limits returning bucket");
    return json(res, 200, {});
  }
  if (path === "/__test/purchasable" && req.method === "GET") {
    // What the release does for a plan with live keys: marks it on sale.
    await q("update public.plans set purchasable = $2 where id = $1 returning id", [url.searchParams.get("plan"), url.searchParams.get("on") === "1"]);
    return json(res, 200, {});
  }
  if (path === "/__test/plan" && req.method === "GET") {
    const plan = url.searchParams.get("plan");
    if (plan === "free") await q("select public.admin_set_plan($1, 'free', 'free', null, null, 'e2e')", [url.searchParams.get("email")]);
    else await q("select public.admin_set_plan($1, $2, 'active', 'month', now() + interval '30 days', 'e2e')", [url.searchParams.get("email"), plan]);
    return json(res, 200, {});
  }
  if (path === "/user" && req.method === "PUT") {
    const claims = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!claims?.sub) return json(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    const b = await body(req);
    if (typeof b.password === "string" && b.password.length < 8) return json(res, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 8 characters." });
    const r = await q("update auth.users set encrypted_password = coalesce($2, encrypted_password) where id = $1 returning *", [claims.sub, b.password ?? null]);
    return json(res, 200, userObj(r.rows[0]));
  }
  return json(res, 404, { msg: `auth shim: ${req.method} ${path} not implemented` });
}

// ---------------------------------------------------------------- billing function + Razorpay stand-in
// The real Edge Function code, in Razorpay test mode, talking to a fake Razorpay API in this process.
export const E2E_RAZORPAY = { keyId: "rzp_test_e2estandin01", keySecret: "e2e-razorpay-key-secret", webhookSecret: "e2e-razorpay-webhook-secret" };
const BILLING = {
  ...E2E_RAZORPAY,
  testers: ["buyer@studio.test", "payer@fixes.test"],
  origins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  supabaseUrl: "http://127.0.0.1:54321",
  anonKey: ANON,
  serviceKey: SERVICE,
  razorpayApi: "https://razorpay.e2e/v1",
};
let rzpSeq = 0;
const rzpSubs = new Map();
// What the fake reports for a subscription after checkout: "active" (charged) or "authenticated" (mandate only).
let rzpStatus = "active";
async function fakeRazorpay(url, init = {}) {
  const u = new URL(url);
  const body = init.body ? JSON.parse(init.body) : {};
  const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  if (init.headers?.authorization !== `Basic ${Buffer.from(`${BILLING.keyId}:${BILLING.keySecret}`).toString("base64")}`) {
    return new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } }), { status: 401 });
  }
  if (u.pathname === "/v1/plans") return ok({ id: `plan_e2e${++rzpSeq}`, period: body.period, item: body.item });
  if (u.pathname === "/v1/subscriptions") {
    const id = `sub_e2e${++rzpSeq}`;
    rzpSubs.set(id, { id, plan_id: body.plan_id, status: "created", customer_id: "cust_e2e", notes: body.notes });
    return ok(rzpSubs.get(id));
  }
  const m = /^\/v1\/subscriptions\/([\w]+)(\/cancel)?$/.exec(u.pathname);
  if (m && rzpSubs.has(m[1])) {
    const sub = rzpSubs.get(m[1]);
    if (m[2]) return ok({ ...sub, status: body.cancel_at_cycle_end ? sub.status : "cancelled" });
    // After the checkout payment the subscription is active for one period.
    const start = now();
    const year = sub.notes?.billing_interval === "year";
    return ok({ ...sub, status: rzpStatus, current_start: start, current_end: start + (year ? 365 : 30) * 86400 });
  }
  return new Response(JSON.stringify({ error: { description: `fake razorpay: ${init.method} ${u.pathname}` } }), { status: 404 });
}
const billingFetch = (url, init) => (String(url).startsWith(BILLING.razorpayApi) ? fakeRazorpay(url, init) : fetch(url, init));

async function blogApi(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://127.0.0.1:54321${url.pathname}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const r = await handleBlogApi(request, { supabaseUrl: "http://127.0.0.1:54321", serviceKey: SERVICE, siteUrl: "http://localhost:3000" });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

// Owner notification emails: the real "notify" function, with Brevo replaced by a list tests can read.
//   GET /functions/v1/notify/__test            → the emails "sent" so far
//   GET /functions/v1/notify/__test?fail=1|0   → make the email provider fail / work
const ownerEmails = [];
let brevoFails = false;
const notifyFetch = async (url, init) => {
  if (!String(url).startsWith("https://api.brevo.com/")) return fetch(url, init);
  if (brevoFails) return new Response("{}", { status: 500 });
  ownerEmails.push({ ...JSON.parse(init.body), apiKeySent: Boolean(init.headers["api-key"]) });
  return new Response(JSON.stringify({ messageId: "e2e" }), { status: 201 });
};
async function notifyApi(req, res, url) {
  if (url.pathname.endsWith("/__test")) {
    if (url.searchParams.has("fail")) brevoFails = url.searchParams.get("fail") === "1";
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(ownerEmails));
  }
  const request = new Request(`http://127.0.0.1:54321${url.pathname}`, { method: req.method });
  const r = await handleNotify(request, { supabaseUrl: "http://127.0.0.1:54321", serviceKey: SERVICE, brevoKey: "e2e-brevo-key", siteUrl: "http://localhost:3000", fromEmail: "no-reply@scopeflow.in", fromName: "ScopeFlow" }, notifyFetch);
  res.writeHead(r.status, { ...Object.fromEntries(r.headers), "access-control-allow-origin": "*" });
  res.end(Buffer.from(await r.arrayBuffer()));
}

// Storage stand-in for the public "blog" bucket: upload (authors only, like the storage policy) and public reads.
const blobs = new Map();
async function storage(req, res, url) {
  const up = /^\/storage\/v1\/object\/blog\/([\w./-]+)$/.exec(url.pathname);
  const pub = /^\/storage\/v1\/object\/public\/blog\/([\w./-]+)$/.exec(url.pathname);
  if (pub && req.method === "GET") {
    const f = blobs.get(pub[1]);
    if (!f) return json(res, 404, { error: "not_found" });
    res.writeHead(200, { "content-type": f.type, "cache-control": "public, max-age=31536000", ...CORS });
    return res.end(f.data);
  }
  if (up && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const check = await fetch("http://127.0.0.1:3001/rpc/is_blog_author", { method: "POST", headers: { authorization: req.headers.authorization ?? "", "content-type": "application/json" }, body: "{}" });
    if (!check.ok || (await check.json()) !== true) return json(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    if (blobs.has(up[1])) return json(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    const type = String(req.headers["content-type"] ?? "");
    if (!/^image\/(webp|jpeg|png)$/.test(type)) return json(res, 415, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${type} is not supported` });
    blobs.set(up[1], { type, data: Buffer.concat(chunks) });
    return json(res, 200, { Key: `blog/${up[1]}`, Id: randomUUID() });
  }
  return json(res, 404, { error: "not_found" });
}

async function billing(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://127.0.0.1:54321${url.pathname}${url.search}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
    body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const r = await handleBilling(request, BILLING, billingFetch);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

// ---------------------------------------------------------------- gateway
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      // Edge Functions answer their own CORS preflight (only for the app's addresses).
      if (url.pathname.startsWith("/functions/v1/billing")) return await billing(req, res, url);
      if (url.pathname.startsWith("/functions/v1/blog")) return await blogApi(req, res, url);
      if (url.pathname.startsWith("/functions/v1/notify")) return await notifyApi(req, res, url);
      if (url.pathname.startsWith("/storage/v1/") && req.method !== "OPTIONS") return await storage(req, res, url);
      if (req.method === "OPTIONS") {
        // Like Supabase: allow whatever headers the client asks for.
        res.writeHead(204, { ...CORS, "access-control-allow-headers": req.headers["access-control-request-headers"] ?? CORS["access-control-allow-headers"] });
        return res.end();
      }
      if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url);
      if (url.pathname.startsWith("/rest/v1")) {
        const headers = { ...req.headers, host: "127.0.0.1:3001", "cf-connecting-ip": req.socket.remoteAddress };
        // Supabase sends the anon/service key as Authorization when no session exists.
        if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
        const up = http.request(
          { host: "127.0.0.1", port: 3001, method: req.method, path: url.pathname.replace("/rest/v1", "") + url.search, headers },
          (r) => { res.writeHead(r.statusCode, { ...r.headers, ...CORS }); r.pipe(res); },
        );
        up.on("error", (e) => json(res, 502, { message: String(e) }));
        req.pipe(up);
        return;
      }
      json(res, 404, { msg: "not found" });
    } catch (e) {
      console.error(e);
      json(res, 500, { msg: String(e) });
    }
  })
  .listen(54321, () => console.log("gateway on :54321"));
