// Usage: POSTGREST_BIN=/path/to/postgrest node tests/e2e/stack.mjs
// Local Supabase stand-in for end-to-end testing:
//   PGlite (real Postgres 17) over the wire protocol -> real PostgREST 12 -> gateway at :54321
//   plus a minimal GoTrue-compatible auth shim (password grant, /user, signup, refresh, logout,
//   password recovery). Recovery "emails" are kept in memory and read by the walkthrough via
//   GET /auth/v1/__test/recovery?email=… (local test stand-in only; never part of the app).
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import { handleBilling } from "../../supabase/functions/billing/handler.ts";

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
// Auth queries go through PostgREST-independent direct access; serialize them.
let chain = Promise.resolve();
const q = (sql, params) => (chain = chain.then(() => db.query(sql, params)));

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
async function auth(req, res, url) {
  const path = url.pathname.replace("/auth/v1", "");
  if (path === "/signup" && req.method === "POST") {
    const b = await body(req);
    const exists = await q("select 1 from auth.users where email = $1", [b.email]);
    if (exists.rows.length) return json(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    const r = await q("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *", [
      b.email, b.password, JSON.stringify(b.data ?? {}),
    ]);
    return json(res, 200, session(r.rows[0]));
  }
  if (path === "/token") {
    const grant = url.searchParams.get("grant_type");
    const b = await body(req);
    if (grant === "password") {
      const r = await q("select * from auth.users where email = $1 and encrypted_password = $2", [b.email, b.password]);
      if (!r.rows.length) return json(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
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
    return json(res, 200, userObj(r.rows[0]));
  }
  if (path === "/logout") { res.writeHead(204, CORS); return res.end(); }
  if (path === "/recover" && req.method === "POST") {
    const b = await body(req);
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
  testers: ["buyer@studio.test"],
  origins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  supabaseUrl: "http://127.0.0.1:54321",
  anonKey: ANON,
  serviceKey: SERVICE,
  razorpayApi: "https://razorpay.e2e/v1",
};
let rzpSeq = 0;
const rzpSubs = new Map();
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
    return ok({ ...sub, status: "active", current_start: start, current_end: start + (year ? 365 : 30) * 86400 });
  }
  return new Response(JSON.stringify({ error: { description: `fake razorpay: ${init.method} ${u.pathname}` } }), { status: 404 });
}
const billingFetch = (url, init) => (String(url).startsWith(BILLING.razorpayApi) ? fakeRazorpay(url, init) : fetch(url, init));

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
