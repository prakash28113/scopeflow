// Usage: POSTGREST_BIN=/path/to/postgrest node tests/e2e/stack.mjs
// Local Supabase stand-in for end-to-end testing:
//   PGlite (real Postgres 17) over the wire protocol -> real PostgREST 12 -> gateway at :54321
//   plus a minimal GoTrue-compatible auth shim (password grant, /user, signup, refresh, logout).
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";

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
const stub = readFileSync(`${PROJECT}/tests/db/harness.ts`, "utf8").split("export const SUPABASE_STUB = `")[1].split("`;")[0];
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
  if (path === "/recover") return json(res, 200, {});
  return json(res, 404, { msg: `auth shim: ${req.method} ${path} not implemented` });
}

// ---------------------------------------------------------------- gateway
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
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
