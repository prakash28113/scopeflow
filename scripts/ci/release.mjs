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
 * Paid plans (optional): RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET (GitHub
 * secrets) are copied into the "billing" Edge Function's secrets, the function is deployed, and paid
 * plans are put on sale only with live keys (test keys: only BILLING_TESTERS can buy).
 *
 * Never prints secrets. Never uses the database password or any service-role key (the Edge Function
 * receives its own from Supabase at run time).
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
export const EXPECTED = { tables: 31, without_rls: 0, public_functions: 5, signup_trigger: 1 };
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

const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Whether this release ships "Continue with Google" (set during the release). */
let googleOn = false;
const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
/** The public Google client ID from config/public-site.json, or "" (no Google button). */
export function googleClientId(text) {
  try {
    const site = JSON.parse(text ?? readFileSync(join(ROOT, "config/public-site.json"), "utf8"));
    const id = String(site.googleClientId ?? "");
    return GOOGLE_CLIENT_ID_RE.test(id) ? id : "";
  } catch {
    return "";
  }
}
/** True when config/public-site.json has a Google client ID (Sign in with Google is shown). */
export function googleSignInEnabled(text) {
  return Boolean(googleClientId(text));
}
/**
 * Supabase Auth settings for "Continue with Google". ScopeFlow signs in with Google ID tokens
 * (signInWithIdToken), which Supabase checks against this client ID and the nonce; no redirect
 * flow and no client secret are needed. GOOGLE_CLIENT_SECRET (a GitHub secret) is passed on
 * only if it was set, for Supabase's optional redirect flow.
 */
export function googleAuthConfig(clientId, secret) {
  if (!clientId) return null;
  const body = { external_google_enabled: true, external_google_client_id: clientId, external_google_skip_nonce_check: false };
  if (secret) body.external_google_secret = secret;
  return body;
}

/**
 * Supabase redirect allow-list: only the reset page and the email-confirmation landing page
 * (which may carry ?next=…) on ScopeFlow's own addresses.
 */
export function authReturnUrls(urls) {
  const own = [...new Set(urls.filter((u) => /^https:\/\/[a-z0-9.-]+$/i.test(u ?? "")))];
  return own.flatMap((u) => [`${u}/reset-password`, `${u}/auth/callback`, `${u}/auth/callback?**`]).join(",");
}

/** Custom domains from config/public-site.json, e.g. "scopeflow.in, www.scopeflow.in". First = primary. */
export function parseDomains(text) {
  const list = String(text ?? "").split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  for (const d of list) {
    if (!HOSTNAME.test(d) || d.endsWith(".workers.dev")) throw new Error(`Not a valid custom domain: "${d}"`);
  }
  return [...new Set(list)];
}

/**
 * Razorpay settings from GitHub secrets. null = paid plans off. A partial setup is reported, not fatal.
 * Keys are only checked for shape here; they're never printed.
 */
export function billingConfig(env, siteText) {
  const keyId = String(env.RAZORPAY_KEY_ID ?? "").trim();
  const keySecret = String(env.RAZORPAY_KEY_SECRET ?? "").trim();
  const webhookSecret = String(env.RAZORPAY_WEBHOOK_SECRET ?? "").trim();
  if (!keyId && !keySecret && !webhookSecret) return null;
  const missing = [];
  if (!/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/.test(keyId)) missing.push("RAZORPAY_KEY_ID (rzp_test_… or rzp_live_…)");
  if (keySecret.length < 8 || /\s/.test(keySecret)) missing.push("RAZORPAY_KEY_SECRET");
  if (webhookSecret.length < 8 || /\s/.test(webhookSecret)) missing.push("RAZORPAY_WEBHOOK_SECRET (8+ characters)");
  if (missing.length) return { error: `Paid plans not switched on: check ${missing.join(", ")}.` };
  let plans = ["solo"];
  try {
    const site = JSON.parse(siteText ?? readFileSync(join(ROOT, "config/public-site.json"), "utf8"));
    if (Array.isArray(site.billingPlans)) plans = site.billingPlans.filter((p) => p === "solo" || p === "studio");
  } catch {}
  return {
    keyId,
    keySecret,
    webhookSecret,
    mode: keyId.startsWith("rzp_live_") ? "live" : "test",
    testers: parseEmails(env.BILLING_TESTERS ?? ""),
    plans,
  };
}

/** SQL that puts plans on sale: live keys → the configured plans; test keys or no keys → none. */
export function purchasableSql(billing) {
  const ids = billing && !billing.error && billing.mode === "live" ? billing.plans : [];
  for (const id of ids) if (!/^(solo|studio)$/.test(id)) throw new Error(`Unexpected plan id: ${id}`);
  const on = `(id = any(array[${ids.map(quote).join(", ")}]::text[]))`;
  return `update public.plans set purchasable = ${on} where purchasable is distinct from ${on};`;
}

export const FUNCTION_FILES = ["index.ts", "handler.ts"];

/**
 * Accounts that get a paid plan free and forever (the owner's own account, partners).
 * From config/public-site.json: "complimentaryPlans": [{ "email": "…", "plan": "studio" }].
 * Applied through admin_set_plan (audited in subscription_changes); removing an entry changes nothing.
 */
export function complimentaryPlans(siteText) {
  let list = [];
  try {
    list = JSON.parse(siteText ?? readFileSync(join(ROOT, "config/public-site.json"), "utf8")).complimentaryPlans ?? [];
  } catch {
    return [];
  }
  return list.map((c) => {
    const [email] = parseEmails(String(c?.email ?? ""));
    if (!email || !["solo", "studio"].includes(c?.plan)) throw new Error(`Invalid complimentary plan entry: ${JSON.stringify(c)}`);
    return { email, plan: c.plan };
  });
}

export const complimentaryCheckSql = (c) => `select
  exists (select 1 from public.profiles where email = ${quote(c.email)}) as found,
  exists (select 1 from public.subscriptions s join public.profiles p on p.id = s.owner_id
           where p.email = ${quote(c.email)} and s.plan_id = ${quote(c.plan)} and s.status = 'active'
             and s.current_period_end is null) as already`;

export const complimentaryGrantSql = (c) =>
  `select public.admin_set_plan(${quote(c.email)}, ${quote(c.plan)}, 'active', 'year', null, 'complimentary (config/public-site.json)');`;

/** Blog authors from config/public-site.json (blogAuthors): the only accounts that can write posts. */
export function blogAuthors(siteText) {
  try {
    const site = JSON.parse(siteText ?? readFileSync(join(ROOT, "config/public-site.json"), "utf8"));
    return parseEmails((site.blogAuthors ?? []).join("\n"));
  } catch (e) {
    if (/Not a valid email/.test(String(e?.message))) throw e;
    return [];
  }
}

export function blogAuthorsSql(emails) {
  for (const e of emails) if (!EMAIL.test(e)) throw new Error(`Invalid email: ${e}`);
  const list = emails.map(quote).join(", ");
  return `begin;
delete from public.blog_authors${emails.length ? ` where email not in (${list})` : ""};
${emails.length ? `insert into public.blog_authors (email) values ${emails.map((e) => `(${quote(e)})`).join(", ")} on conflict (email) do nothing;` : ""}
commit;`;
}

const short = (s) => String(s).replace(/\s+/g, " ").slice(0, 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} deps  injectable for tests
 *   env, fetch, exec(cmd, args, opts) → stdout, log(msg), summary(markdown),
 *   migrations: [{ name, body }], allowlistFile: string, wait(ms)
 */
export async function run(deps) {
  // "Continue with Google" ships only when Supabase accepts it (setUpSupabase can turn it off);
  // an app-only release keeps the configured value.
  googleOn = googleSignInEnabled();
  const { env, fetch, exec, log, summary, migrations, allowlistFile, wait = sleep } = deps;
  const report = [];
  const ok = (m) => { report.push(`- ✅ ${m}`); log(`✓ ${m}`); };
  const finish = (status, extra = []) => {
    summary(["## ScopeFlow release", "", ...report, ...extra].join("\n"));
    return status;
  };

  // ------------------------------------------------------------------ Supabase
  const sbToken = env.SUPABASE_ACCESS_TOKEN;
  let supabaseUrl, publishable, setSiteUrl, setUpBilling, setUpBlog;
  if (sbToken) {
    ({ supabaseUrl, publishable, setSiteUrl, setUpBilling, setUpBlog } = await setUpSupabase());
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

  // Least privilege: with the public settings in config/public-supabase.json the token only
  // needs Database access (+ Auth config to manage sign-in settings). Without them, it also
  // needs Project read (to find the project) and API-keys read (to fetch the public key).
  const configured = env.SUPABASE_URL ? publicSupabaseConfig(env) : null;
  const projectName = env.SUPABASE_PROJECT_NAME || "scopeflow-beta";
  let project;
  if (configured) project = { ref: new URL(configured.supabaseUrl).hostname.split(".")[0], status: "ACTIVE_HEALTHY", configured: true };
  for (let attempt = 0; !project; attempt++) {
    const projects = await sb("/projects");
    const matches = projects.filter((p) => p.name === projectName);
    if (matches.length !== 1) {
      const names = projects.map((p) => p.name).join(", ") || "none";
      throw new Error(`Expected exactly one Supabase project named "${projectName}", found ${matches.length} (projects: ${names}).`);
    }
    if (matches[0].status === "ACTIVE_HEALTHY") { project = matches[0]; break; }
    if (attempt >= 20) throw new Error(`Supabase project is "${matches[0].status}", not ACTIVE_HEALTHY. If it's paused, tap "Resume project" in Supabase.`);
    log(`Supabase project status is ${matches[0].status}; waiting…`);
    await wait(15_000);
  }
  const ref = project.ref ?? project.id;
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("Unexpected Supabase project reference format.");
  const supabaseUrl = `https://${ref}.supabase.co`;
  ok(project.configured ? `Supabase project \`${ref}\` (from config/public-supabase.json)` : `Supabase project **${projectName}** found (${project.region ?? "region n/a"})`);
  /** Settings changes the token may not be scoped for: skipped with a note, never fatal. */
  const optional = async (label, path, body) => {
    try {
      await sb(path, { method: "PATCH", body });
      ok(label);
    } catch (e) {
      if (!/\((401|403)\)/.test(String(e.message))) throw e;
      log(`::notice::${label} — skipped: the token has no Auth config permission (settings left as they are).`);
      report.push(`- ⏭️ ${label} — skipped (token not scoped for Auth config; nothing changed)`);
    }
  };

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
  ok(`Security check passed: ${EXPECTED.tables} tables, RLS on all, ${EXPECTED.public_functions} public functions, sign-up trigger present`);

  // "Confirm email" and CAPTCHA are the owner's switches in the Supabase dashboard; a release never
  // changes them (it used to turn confirmation off every time). The app works with either setting.
  await optional("Sign-in configured: email + password, minimum 8 characters (email confirmation and CAPTCHA left as set in Supabase)", `/projects/${ref}/config/auth`, {
    external_email_enabled: true,
    password_min_length: 8,
    disable_signup: false,
  });

  // Sign in with Google: switched on in Supabase before the button ships. A failure stops the
  // release here, before deploying, so the site never shows a Google button that can't work.
  const google = googleAuthConfig(googleClientId(), env.GOOGLE_CLIENT_SECRET);
  if (google) {
    try {
      await sb(`/projects/${ref}/config/auth`, { method: "PATCH", body: google });
      ok("Sign in with Google switched on in Supabase (ID-token sign-in, nonce checked)");
    } catch (e) {
      if (!/\((401|403)\)/.test(String(e.message))) throw e;
      googleOn = false;
      log("::notice::Sign in with Google — not switched on: the token has no Auth config permission. The Google button is left out of this release.");
      report.push("- ⏭️ Sign in with Google — left out (token not scoped for Auth config)");
    }
  }

  const allowText = [allowlistFile ?? "", env.BETA_EMAILS ?? ""].join("\n");
  if (signupsOpen(allowText)) {
    await sql("delete from public.beta_allowlist;");
    ok("Sign-ups are **open** to everyone (allowlist cleared)");
  } else {
    const emails = parseEmails(allowText);
    await sql(allowlistSql(emails));
    ok(emails.length ? `Beta allowlist synced (${emails.length} email${emails.length === 1 ? "" : "s"})` : "Beta allowlist empty → sign-ups kept **closed**");
  }

  // Complimentary plans (config/public-site.json → complimentaryPlans): set once, never expire.
  for (const c of complimentaryPlans()) {
    const [state] = await sql(complimentaryCheckSql(c));
    if (!state?.found) {
      log(`::notice::Complimentary ${c.plan}: no account yet for ${c.email}; it will be applied on a release after they sign up.`);
      report.push(`- ⏭️ Complimentary ${c.plan === "studio" ? "Studio" : "Solo"} waiting: no account yet for the configured email (sign up, then release again)`);
    } else if (state.already) {
      ok(`Complimentary ${c.plan === "studio" ? "Studio" : "Solo"} already active for ${c.email}`);
    } else {
      await sql(complimentaryGrantSql(c));
      ok(`Complimentary ${c.plan === "studio" ? "Studio" : "Solo"} switched on for ${c.email} (no end date)`);
    }
  }

  let publishable = configured?.publishable;
  if (!publishable) {
    const keys = await sb(`/projects/${ref}/api-keys?reveal=false`);
    publishable = keys.find((k) => k.type === "publishable")?.api_key ?? keys.find((k) => k.name === "anon")?.api_key;
    if (!publishable || /[*•·]/.test(publishable)) throw new Error("Could not read the project's publishable (anon) key.");
  }
  ok("Public Supabase URL and publishable key ready");

  /** Deploys supabase/functions/<slug> (index.ts + handler.ts) with JWT verification off (the function checks callers itself). */
  async function deployFunction(slug) {
    const form = new FormData();
    form.append("metadata", JSON.stringify({ entrypoint_path: "index.ts", name: slug, verify_jwt: false }));
    for (const f of FUNCTION_FILES) {
      form.append("file", new Blob([readFileSync(join(ROOT, "supabase/functions", slug, f), "utf8")], { type: "application/typescript" }), f);
    }
    const res = await fetch(`${SUPABASE_API}/projects/${ref}/functions/deploy?slug=${slug}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sbToken}` },
      body: form,
    });
    const deployed = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Supabase API POST /functions/deploy failed (${res.status}): ${short(JSON.stringify(deployed))}`);
    if (deployed.verify_jwt !== false) await sb(`/projects/${ref}/functions/${slug}`, { method: "PATCH", body: { verify_jwt: false } });
  }

  /** Blog: authors from config/public-site.json, and the publishing API for tools. */
  async function setUpBlog(authors) {
    await sql(blogAuthorsSql(authors));
    ok(`Blog authors synced (${authors.length})`);
    try {
      await deployFunction("blog");
      ok("Blog publishing API deployed");
      report.push(`- ℹ️ Blog publishing API: \`${supabaseUrl}/functions/v1/blog/posts\``);
    } catch (e) {
      if (!/\((401|403)\)/.test(String(e.message))) throw e;
      log("::warning::Blog publishing API not deployed: the Supabase token needs Edge Functions access.");
      report.push("- ⏭️ Blog publishing API not deployed — the `SUPABASE_ACCESS_TOKEN` needs **Edge Functions** write access. Writing in the app still works.");
    }
  }

  /**
   * Paid plans: function secrets, the "billing" Edge Function, and which plans are on sale.
   * Returns true when checkout is available. Needs a token with Edge Functions + Secrets access;
   * without it, paid plans stay off and the run says so.
   */
  async function setUpBilling(billing, origins) {
    if (!billing || billing.error) {
      await sql(purchasableSql(null));
      if (billing?.error) {
        log(`::warning::${billing.error}`);
        report.push(`- ⏭️ ${billing.error} Nothing is on sale.`);
      }
      return false;
    }
    try {
      await sb(`/projects/${ref}/secrets`, {
        method: "POST",
        body: [
          { name: "RAZORPAY_KEY_ID", value: billing.keyId },
          { name: "RAZORPAY_KEY_SECRET", value: billing.keySecret },
          { name: "RAZORPAY_WEBHOOK_SECRET", value: billing.webhookSecret },
          { name: "BILLING_TESTERS", value: billing.testers.join(",") || "none@scopeflow.invalid" },
          { name: "APP_ORIGINS", value: origins.join(",") },
        ],
      });
      await deployFunction("billing");
    } catch (e) {
      if (!/\((401|403)\)/.test(String(e.message))) throw e;
      await sql(purchasableSql(null));
      log("::warning::Paid plans not switched on: the Supabase token needs Edge Functions and Secrets access.");
      report.push("- ⏭️ Paid plans not switched on — the `SUPABASE_ACCESS_TOKEN` needs **Edge Functions** and **Secrets** write access. Nothing is on sale.");
      return false;
    }
    await sql(purchasableSql(billing));
    ok(
      billing.mode === "live"
        ? `Payments: Razorpay **live** — on sale: ${billing.plans.map((p) => (p === "solo" ? "Solo" : "Studio")).join(", ") || "nothing"}`
        : `Payments: Razorpay **test mode** — only ${billing.testers.length} tester account${billing.testers.length === 1 ? "" : "s"} (BILLING_TESTERS) can buy; nothing is on sale`,
    );
    report.push(`- ℹ️ Razorpay webhook URL: \`${supabaseUrl}/functions/v1/billing/webhook\` (events: subscription.*)`);
    return true;
  }

  return {
    supabaseUrl,
    publishable,
    setUpBilling,
    setUpBlog,
    // Password-reset links may only return to ScopeFlow's own addresses.
    setSiteUrl: (appUrl, allUrls = [appUrl]) =>
      optional("Supabase Site URL and sign-in return addresses set to the live addresses", `/projects/${ref}/config/auth`, {
        site_url: appUrl,
        uri_allow_list: authReturnUrls(allUrls),
      }),
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

  const domains = parseDomains(env.CUSTOM_DOMAINS);
  const origins = [...domains.map((d) => `https://${d}`), `https://scopeflow.${subdomain}.workers.dev`];
  // Paid plans need the Supabase token (function + secrets); an app-only release leaves them as they are.
  const billingOn = setUpBilling ? await setUpBilling(billingConfig(env), origins) : false;
  if (setUpBlog) await setUpBlog(blogAuthors());

  const buildEnv = {
    ...process.env,
    VITE_BILLING_PROVIDER: billingOn ? "razorpay" : "",
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
    VITE_TURNSTILE_SITE_KEY: env.VITE_TURNSTILE_SITE_KEY ?? "",
    VITE_GOOGLE_CLIENT_ID: googleOn ? googleClientId() : "",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: publishable,
  };
  exec("npm", ["run", "build"], { env: buildEnv });
  exec("node", ["scripts/predeploy-check.mjs"], { env: buildEnv });
  ok("Built the app and passed the pre-deploy check");

  const domainArgs = domains.flatMap((d) => ["--domain", d]);
  const out = exec("npx", ["wrangler", "deploy", "--var", `SUPABASE_URL:${supabaseUrl}`, "--var", `SUPABASE_ANON_KEY:${publishable}`, "--var", `TURNSTILE_ENABLED:${env.VITE_TURNSTILE_SITE_KEY ? "true" : "false"}`, "--var", `GOOGLE_SIGNIN_ENABLED:${googleOn ? "true" : "false"}`, "--var", `BILLING_ENABLED:${billingOn ? "true" : "false"}`, ...domainArgs], {
    env: { ...buildEnv, CLOUDFLARE_API_TOKEN: cfToken, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_SEND_METRICS: "false" },
  });
  const workersUrl = (String(out).match(/https:\/\/scopeflow\.[a-z0-9-]+\.workers\.dev/) ?? [`https://scopeflow.${subdomain}.workers.dev`])[0];
  // The custom domain (when configured) is the address people use; workers.dev keeps working for old links.
  const appUrl = domains.length ? `https://${domains[0]}` : workersUrl;
  ok(`Deployed to Cloudflare Workers Free: ${appUrl}${domains.length ? ` (also ${domains.slice(1).map((d) => `https://${d}`).concat(workersUrl).join(", ")})` : ""}`);

  if (setSiteUrl) await setSiteUrl(appUrl, [...domains.map((d) => `https://${d}`), workersUrl]);

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

  // Search engines see the prerendered home page, indexable, with its canonical address.
  // The previous version can keep answering for a short while after a deploy, so give the new one up to a minute.
  let homeHtml = await home.text();
  for (let i = 0; i < 12 && !homeHtml.includes('data-page="/"'); i++) {
    await wait(5_000);
    home = await fetch(appUrl + "/", { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } });
    homeHtml = await home.text();
  }
  if (!homeHtml.includes('data-page="/"') || !homeHtml.includes('rel="canonical"')) throw new Error("Live home page isn't the prerendered page (check dist/_redirects).");
  if (/<meta name="robots"[^>]*noindex/i.test(homeHtml) || /noindex/i.test(home.headers.get("x-robots-tag") ?? "")) throw new Error("Live home page is marked noindex.");
  const sitemap = await fetch(appUrl + "/sitemap.xml");
  if (!sitemap.ok || !(await sitemap.text()).includes("<urlset")) throw new Error("Live sitemap.xml is missing.");
  passed.push("Home page is prerendered and indexable; sitemap is live");

  // Unknown addresses are real 404s (no "soft 404s" for search engines).
  const missing = await fetch(appUrl + "/this-page-does-not-exist", { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } });
  if (missing.status !== 404) throw new Error(`Unknown pages should answer 404 (got ${missing.status}).`);
  passed.push("Unknown pages answer 404, not the app with 200");

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
  let site = {};
  try { site = JSON.parse(readFileSync(join(ROOT, "config/public-site.json"), "utf8")); } catch {}
  run({
    env: {
      SUPABASE_URL: publicConfig.url,
      SUPABASE_PUBLISHABLE_KEY: publicConfig.publishableKey,
      SUPABASE_DATABASE_VERSION: publicConfig.databaseVersion,
      CUSTOM_DOMAINS: (site.customDomains ?? []).join(","),
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
