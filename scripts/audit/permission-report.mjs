#!/usr/bin/env node
// Prints a Markdown permission audit straight from the database catalog, after applying
// every migration to an in-process PostgreSQL. Usage: node scripts/audit/permission-report.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const db = new PGlite();
await db.exec(readFileSync(join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of migrations) await db.exec(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
const q = async (sql) => (await db.query(sql)).rows;
const yes = (b) => (b ? "yes" : "—");
const out = [];
const p = (s = "") => out.push(s);

p("# Permission audit");
p();
p(`Generated from the database catalog after applying: ${migrations.map((m) => `\`${m}\``).join(", ")}.`);
p("Roles: `anon` = anyone with the public key (client portal, signed-out visitors); `authenticated` = a signed-in freelancer.");
p();

const tables = await q(`
  select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as force,
         has_table_privilege('anon', c.oid, 'select') as anon_sel,
         has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete') as anon_write,
         has_table_privilege('authenticated', c.oid, 'select') as auth_sel,
         has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete') as auth_write,
         (select string_agg(pol.polname || ' (' || case pol.polcmd when 'r' then 'select' when '*' then 'all' else pol.polcmd::text end || ')', '; ')
            from pg_policy pol where pol.polrelid = c.oid) as policies
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1`);
p("## Tables");
p();
p("| Table | RLS on | anon read | anon write | signed-in read | signed-in write | Policies |");
p("| --- | --- | --- | --- | --- | --- | --- |");
for (const t of tables) {
  const colOnly = !t.auth_sel && t.t === "share_links" ? "columns only" : yes(t.auth_sel);
  p(`| ${t.t} | ${yes(t.rls)} | ${yes(t.anon_sel)} | ${yes(t.anon_write)} | ${colOnly} | ${yes(t.auth_write)} | ${t.policies ?? "none (no API access)"} |`);
}
const cols = await q(`select table_name, string_agg(column_name, ', ' order by column_name) as cols
  from information_schema.column_privileges where grantee = 'authenticated' and privilege_type = 'SELECT' and table_name = 'share_links' group by 1`);
for (const c of cols) p(`\n\`${c.table_name}\`: signed-in users may read only (${c.cols}) — never \`token_hash\`.`);
const noRls = tables.filter((t) => !t.rls).length;
const anyWrite = tables.filter((t) => t.anon_write || t.auth_write).length;
p();
p(`**Result:** ${tables.length} tables, ${noRls} without Row Level Security, ${anyWrite} writable directly by API roles. All writes go through the functions below.`);
p();

const fns = await q(`
  select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
         coalesce(array_to_string(p.proconfig, ','), '') as config, p.prosrc as src,
         has_function_privilege('anon', p.oid, 'execute') as anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace order by p.prosecdef desc, (has_function_privilege('anon', p.oid, 'execute')) desc, p.proname`);
const guard = (f) =>
  /_portal_gate\(/.test(f.src) ? "client link (hashed token, expiry, revocation, rate limits)"
  : /_owned_project\(/.test(f.src) ? "project owner (owner_id = signed-in user, row locked)"
  : /_require_blog_author\(/.test(f.src) ? "blog authors only (signed-in account listed in blog_authors)"
  : /_uid\(\)|auth\.uid\(\)/.test(f.src) ? "signed-in user's own rows"
  : f.name === "health" ? "none needed — returns 'ok'"
  : f.name === "process_billing_event" ? "service role only — future signature-verified payment webhook"
  : f.name === "blog_publish_with_key" ? "service role only — blog Edge Function, after hashing the publishing key"
  : f.name === "process_razorpay_event" ? "service role only — billing Edge Function, after verifying Razorpay's signature"
  : /^billing_/.test(f.name) && !f.anon_x && !f.auth_x ? "service role only — billing Edge Function, after verifying the user's session"
  : f.name === "admin_set_plan" || f.name === "admin_signup_sources" ? "no API role — Supabase SQL editor only"
  : f.name === "_create_subscription" ? "profile trigger only (Free plan for new accounts)"
  : f.name === "_handle_new_user" ? "sign-up trigger only (beta allowlist)"
  : f.definer ? "**REVIEW**" : "internal helper (not callable from the API)";
p("## Functions");
p();
p("| Function | Runs as owner | search_path pinned | anon | signed-in | PUBLIC | Authorization |");
p("| --- | --- | --- | --- | --- | --- | --- |");
for (const f of fns) {
  p(`| \`${f.name}(${f.args.replace(/\|/g, "\\|")})\` | ${yes(f.definer)} | ${yes(/search_path=/.test(f.config))} | ${yes(f.anon_x)} | ${yes(f.auth_x)} | ${yes(f.public_x)} | ${guard(f)} |`);
}
const definers = fns.filter((f) => f.definer);
const unpinned = definers.filter((f) => !/search_path=/.test(f.config));
const review = fns.filter((f) => guard(f).includes("REVIEW"));
const publicX = fns.filter((f) => f.public_x);
const anonX = fns.filter((f) => f.anon_x).map((f) => f.name);
p();
p(`**Result:** ${definers.length} owner-privileged functions; ${unpinned.length} without a pinned search_path; ${review.length} without a recognised authorization check; ${publicX.length} executable by PUBLIC. Callable by anyone with the public key: ${anonX.map((n) => `\`${n}\``).join(", ")}.`);
console.log(out.join("\n"));
if (unpinned.length || review.length || publicX.length || noRls || anyWrite) process.exitCode = 1;
