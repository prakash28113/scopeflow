#!/usr/bin/env node
/**
 * ScopeFlow release automation — runs in GitHub Actions (see .github/workflows/release.yml).
 *
 * With only two secrets it does the whole deployment:
 *   SUPABASE_ACCESS_TOKEN  → finds the Supabase project, applies database migrations (once each,
 *                            atomically), verifies security invariants, configures sign-in,
 *                            syncs the beta allowlist, reads the public URL + publishable key.
 *   CLOUDFLARE_API_TOKEN   → builds the app and deploys it to Cloudflare Workers Free, then
 *                            smoke-tests the live site and database.
 * If a secret is missing it stops cleanly and says what's needed (the run still shows green).
 *
 * Never prints secrets. Never uses the database password or any service-role key.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SUPABASE_API = "https://api.supabase.com/v1";
const CF_API = "https://api.cloudflare.com/client/v4";

/** Expected results of the post-migration security check (see DEPLOYMENT.md §2). */
export const EXPECTED = { tables: 14, without_rls: 0, public_functions: 5, signup_trigger: 1 };
/** Keeps sign-ups closed when no invited emails are configured. */
export const CLOSED_SENTINEL = "invites-closed@scopeflow.invalid";
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

export const VERIFY_SQL = `select
 (select count(*)::int from pg_tables where schemaname = 'public') as tables,
 (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity) as without_rls,
 (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'EXECUTE')) as public_functions,
 (select count(*)::int from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') as signup_trigger`;

/** Parses invite emails from a file or variable: commas/whitespace separated, '#' comments allowed. */
export const OPEN_SIGNUPS = "*";

/** True when the allowlist file opts into public sign-ups (a line containing only "*"). */
export function signupsOpen(text) {
  return String(text ?? "").split("\n").some((l) => l.replace(/#.*/, "").trim() === OPEN_SIGNUPS);
}

export function parseEmails(text) {
  const out = new Set();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/#.*/, "");
    for (const token of line.split(/[\s,;]+/)) {
      const e = token.trim().toLowerCase();
      if (!e || e === OPEN_SIGNUPS) continue;
      if (!EMAIL.test(e) || e.length > 254) throw new Error(`Not a valid email in the beta allowlist: "${token}"`);
      out.add(e);
    }
  }
  return [...out].sort();
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function allowlistSql(emails) {
  const list = emails.length ? emails : [CLOSED_SENTINEL];
  for (const e of list) if (!EMAIL.test(e) && e !== CLOSED_SENTINEL) throw new Error(`Invalid email: ${e}`);
  const values = list.map((e) => `(${quote(e)}, 'managed by release automation')`).join(", ");
  return `begin;
delete from public.beta_allowlist where email not in (${list.map(quote).join(", ")});
insert into public.beta_allowlist (email, note) values ${values} on conflict (email) do nothing;
commit;`;
}

export function migrationSql(name, body) {
  if (!MIGRATION_NAME.test(name)) throw new Error(`Unexpected migration file name: ${name}`);
  return `begin;\n${body}\ninsert into scopeflow_admin.applied_migrations (name) values (${quote(name)});\ncommit;`;
}

/** Validates public Supabase settings for an app-only release. Refuses anything that looks secret. */
export function publicSupabaseConfig(env) {
  const url = String(env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) throw new Error("SUPABASE_URL must look like https://<project-ref>.supabase.co");
  if (/^sb_secret_/.test(key)) throw new Error("That is a SECRET key — never use it here. Use the publishable key.");
  if (key.startsWith("eyJ")) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch {}
    if (role !== "anon") throw new Error("Only the public anon key may be used here, never service_role.");
  } else if (!/^sb_publishable_[A-Za-z0-9_-]{6,}$/.test(key)) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY must be the publishable key (sb_publishable_…).");
  }
  return { supabaseUrl: url, publishable: key };
}

const short = (s) => String(s).replace(/\s+/g, " ").slice(0, 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} deps  injectable for tests
 *   env, fetch, exec(cmd, args, opts) → stdout, log(msg), summary(markdown),
 *   migrations: [{ name, body }], allowlistFile: string, wait(ms)
 */
export async function run(deps) {
  const { env, fetch, exec, log, summary, migrations, allowlistFile, wait = sleep } = deps;
  const report = [];
  const ok = (m) => { report.push(`- ✅ ${m}`); log(`✓ ${m}`); };
  const finish = (status, extra = []) => {
    summary(["## ScopeFlow release", "", ...report, ...extra].join("\n"));
    return status;
  };

  // ------------------------------------------------------------------ Supabase
  const sbToken = env.SUPABASE_ACCESS_TOKEN;
  let supabaseUrl, publishable, setSiteUrl;
  if (sbToken) {
    ({ supabaseUrl, publishable, setSiteUrl } = await setUpSupabase());
  } else if (env.SUPABASE_URL || env.SUPABASE_PUBLISHABLE_KEY) {
    // App-only release: the database was already set up by an earlier run; use its public values.
    ({ supabaseUrl, publishable } = publicSupabaseConfig(env));
    // Never ship app code that expects database changes that haven't been applied yet.
    const newest = migrations.map((m) => m.name).sort().at(-1);
    if (newest && env.SUPABASE_DATABASE_VERSION !== newest) {
      if (!env.CLOUDFLARE_API_TOKEN) {
        log(`::notice::Database migration ${newest} is waiting to be applied — nothing deployed.`);
        return finish("waiting-supabase", ["", `⏳ **Database update pending:** \`${newest}\` needs a run with SUPABASE_ACCESS_TOKEN before the app can be published.`]);
      }
      throw new Error(
        `Database migration ${newest} hasn't been applied (database is at ${env.SUPABASE_DATABASE_VERSION || "unknown"}). Run the release with SUPABASE_ACCESS_TOKEN so the database is updated first.`,
      );
    }
    ok("Using the public Supabase URL and publishable key from config/public-supabase.json (database set up earlier)");
  } else {
    log("::notice::Waiting for the SUPABASE_ACCESS_TOKEN secret — nothing deployed yet.");
    return finish("waiting-supabase", ["", "⏳ **Waiting for setup:** add the `SUPABASE_ACCESS_TOKEN` secret (see DEPLOYMENT.md, *Automatic deployment*)."]);
  }

  async function setUpSupabase() {
  const sb = async (path, { method = "GET", body } = {}) => {
    const res = await fetch(SUPABASE_API + path, {
      method,
      headers: { Authorization: `Bearer ${sbToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase API ${method} ${path.split("?")[0]} failed (${res.status}): ${short(text)}`);
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  };

  const projectName = env.SUPABASE_PROJECT_NAME || "scopeflow-beta";
  let project;
  for (let attempt = 0; ; attempt++) {
    const projects = await sb("/projects");
    const matches = projects.filter((p) => p.name === projectName);
    if (matches.length !== 1) {
      const names = projects.map((p) => p.name).join(", ") || "none";
      throw new Error(`Expected exactly one Supabase project named "${projectName}", found ${matches.length} (projects: ${names}).`);
    }
    project = matches[0];
    if (project.status === "ACTIVE_HEALTHY") break;
    if (attempt >= 20) throw new Error(`Supabase project is "${project.status}", not ACTIVE_HEALTHY. If it's paused, tap "Resume project" in Supabase.`);
    log(`Supabase project status is ${project.status}; waiting…`);
    await wait(15_000);
  }
  const ref = project.ref ?? project.id;
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("Unexpected Supabase project reference format.");
  const supabaseUrl = `https://${ref}.supabase.co`;
  ok(`Supabase project **${projectName}** found (${project.region ?? "region n/a"})`);

  const sql = (query) => sb(`/projects/${ref}/database/query`, { method: "POST", body: { query } });

  // Migrations: each applied exactly once, inside its own transaction, recorded in a private schema.
  await sql(`create schema if not exists scopeflow_admin;
create table if not exists scopeflow_admin.applied_migrations (name text primary key, applied_at timestamptz not null default now());
revoke all on schema scopeflow_admin from public, anon, authenticated;
revoke all on all tables in schema scopeflow_admin from public, anon, authenticated;`);
  const applied = new Set((await sql("select name from scopeflow_admin.applied_migrations")).map((r) => r.name));
  const pending = migrations.filter((m) => !applied.has(m.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (pending.length && applied.size === 0) {
    const [existing] = await sql("select to_regclass('public.projects') is not null as present");
    if (existing?.present) {
      throw new Error("ScopeFlow tables already exist but were not installed by this automation. Run supabase/rollback/teardown.sql once in the SQL Editor (it only removes ScopeFlow objects), then re-run.");
    }
  }
  for (const m of pending) {
    await sql(migrationSql(m.name, m.body));
    ok(`Applied database migration \`${m.name}\``);
  }
  if (!pending.length) ok("Database already up to date");

  const [check] = await sql(VERIFY_SQL);
  for (const [k, v] of Object.entries(EXPECTED)) {
    if (Number(check?.[k]) !== v) throw new Error(`Security check failed: ${k} = ${check?.[k]}, expected ${v}.`);
  }
  ok("Security check passed: 14 tables, RLS on all, 5 public functions, sign-up trigger present");

  await sb(`/projects/${ref}/config/auth`, {
    method: "PATCH",
    body: { external_email_enabled: true, mailer_autoconfirm: true, password_min_length: 8, disable_signup: false },
  });
  ok("Sign-in configured: email + password, no confirmation email, minimum 8 characters");

  const allowText = [allowlistFile ?? "", env.BETA_EMAILS ?? ""].join("\n");
  if (signupsOpen(allowText)) {
    await sql("delete from public.beta_allowlist;");
    ok("Sign-ups are **open** to everyone (allowlist cleared)");
  } else {
    const emails = parseEmails(allowText);
    await sql(allowlistSql(emails));
    ok(emails.length ? `Beta allowlist synced (${emails.length} email${emails.length === 1 ? "" : "s"})` : "Beta allowlist empty → sign-ups kept **closed**");
  }

  const keys = await sb(`/projects/${ref}/api-keys?reveal=false`);
  const publishable = keys.find((k) => k.type === "publishable")?.api_key ?? keys.find((k) => k.name === "anon")?.api_key;
  if (!publishable || /[*•·]/.test(publishable)) throw new Error("Could not read the project's publishable (anon) key.");
  ok("Read the public Supabase URL and publishable key");
  return {
    supabaseUrl,
    publishable,
    setSiteUrl: async (appUrl) => {
      await sb(`/projects/${ref}/config/auth`, { method: "PATCH", body: { site_url: appUrl } });
      ok("Supabase Site URL set to the live address");
    },
  };
  }

  // ------------------------------------------------------------------ Cloudflare
  const cfToken = env.CLOUDFLARE_API_TOKEN;
  if (!cfToken) {
    log("::notice::Database is ready. Waiting for the CLOUDFLARE_API_TOKEN secret to publish the app.");
    return finish("waiting-cloudflare", ["", "⏳ **Database ready.** Add the `CLOUDFLARE_API_TOKEN` secret to publish the app."]);
  }
  const cf = async (path, { method = "GET", body } = {}) => {
    const res = await fetch(CF_API + path, {
      method,
      headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && json.success !== false, json };
  };

  let accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    const r = await cf("/accounts");
    const accounts = r.json.result ?? [];
    if (!r.ok || accounts.length !== 1) throw new Error(`Couldn't pick a Cloudflare account automatically (found ${accounts.length}). Add the CLOUDFLARE_ACCOUNT_ID secret.`);
    accountId = accounts[0].id;
  }

  let subdomain = (await cf(`/accounts/${accountId}/workers/subdomain`)).json.result?.subdomain;
  if (!subdomain) {
    const wanted = `scopeflow-${randomBytes(3).toString("hex")}`;
    const r = await cf(`/accounts/${accountId}/workers/subdomain`, { method: "PUT", body: { subdomain: wanted } });
    if (!r.ok) throw new Error("Couldn't register a free workers.dev subdomain. Open Cloudflare → Workers & Pages once (it asks you to pick a subdomain), then re-run.");
    subdomain = wanted;
    ok(`Registered free address *.${subdomain}.workers.dev`);
  }

  const buildEnv = {
    ...process.env,
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
    VITE_TURNSTILE_SITE_KEY: env.VITE_TURNSTILE_SITE_KEY ?? "",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: publishable,
  };
  exec("npm", ["run", "build"], { env: buildEnv });
  exec("node", ["scripts/predeploy-check.mjs"], { env: buildEnv });
  ok("Built the app and passed the pre-deploy check");

  const out = exec("npx", ["wrangler", "deploy", "--var", `SUPABASE_URL:${supabaseUrl}`, "--var", `SUPABASE_ANON_KEY:${publishable}`, "--var", `TURNSTILE_ENABLED:${env.VITE_TURNSTILE_SITE_KEY ? "true" : "false"}`], {
    env: { ...buildEnv, CLOUDFLARE_API_TOKEN: cfToken, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_SEND_METRICS: "false" },
  });
  const appUrl = (String(out).match(/https:\/\/scopeflow\.[a-z0-9-]+\.workers\.dev/) ?? [`https://scopeflow.${subdomain}.workers.dev`])[0];
  ok(`Deployed to Cloudflare Workers Free: ${appUrl}`);

  if (setSiteUrl) await setSiteUrl(appUrl);

  // ------------------------------------------------------------------ live smoke tests
  const checks = await smokeTest({ fetch, wait, appUrl, supabaseUrl, publishable });
  for (const c of checks) ok(c);

  return finish("deployed", ["", `**Live:** ${appUrl}`]);
}

export async function smokeTest({ fetch, wait = sleep, appUrl, supabaseUrl, publishable }) {
  const passed = [];
  // New deployments can take a few seconds to propagate; a brand-new workers.dev subdomain can take several minutes.
  let home;
  for (let i = 0; i < 72; i++) {
    home = await fetch(appUrl + "/", { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } }).catch(() => null);
    if (home?.ok) break;
    await wait(5_000);
  }
  if (!home?.ok) throw new Error(`Live site didn't respond with 200 (got ${home?.status ?? "no response"}).`);
  const csp = home.headers.get("content-security-policy") ?? "";
  if (!csp.includes(new URL(supabaseUrl).origin)) throw new Error("Live site is missing the expected Content-Security-Policy.");
  if ((home.headers.get("x-frame-options") ?? "").toUpperCase() !== "DENY") throw new Error("Live site is missing X-Frame-Options: DENY.");
  passed.push("Live site responds with security headers (CSP pinned to Supabase, framing denied)");

  const portal = await fetch(appUrl + "/p", { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } });
  if (!/noindex/i.test(portal.headers.get("x-robots-tag") ?? "")) throw new Error("Client portal page is missing noindex.");
  passed.push("Client portal page is private (noindex, no-store)");

  const api = (path, body) =>
    fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { apikey: publishable, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const health = await api("rpc/health", {});
  if (!health.ok || (await health.json()) !== "ok") throw new Error("Database health check failed.");
  passed.push("Database reachable through the public API");

  const fake = randomBytes(32).toString("base64url");
  const pv = await (await api("rpc/portal_view", { p_token: fake })).json();
  if (pv?.error !== "invalid_link") throw new Error(`Unexpected portal response for a fake link: ${short(JSON.stringify(pv))}`);
  passed.push("Fake client links are rejected");

  const leak = await api("projects?select=id");
  if (leak.ok) {
    const rows = await leak.json().catch(() => null);
    if (Array.isArray(rows) && rows.length) throw new Error("SECURITY: anonymous request could read projects!");
  }
  passed.push("Anonymous visitors can't read any project data");
  return passed;
}

// ------------------------------------------------------------------ CLI (GitHub Actions)
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const dir = join(ROOT, "supabase/migrations");
  const migrations = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
  let allowlistFile = "";
  try { allowlistFile = readFileSync(join(ROOT, "config/beta-allowlist.txt"), "utf8"); } catch {}
  let publicConfig = {};
  try { publicConfig = JSON.parse(readFileSync(join(ROOT, "config/public-supabase.json"), "utf8")); } catch {}
  run({
    env: {
      SUPABASE_URL: publicConfig.url,
      SUPABASE_PUBLISHABLE_KEY: publicConfig.publishableKey,
      SUPABASE_DATABASE_VERSION: publicConfig.databaseVersion,
      ...process.env,
    },
    fetch: globalThis.fetch,
    exec: (cmd, args, opts) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }),
    log: (m) => console.log(m),
    summary: (md) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); console.log(md); },
    migrations,
    allowlistFile,
  })
    .then((status) => console.log(`Result: ${status}`))
    .catch((e) => {
      console.error(`::error::${e.message}`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n❌ **Release stopped:** ${e.message}\n`);
      process.exit(1);
    });
}
