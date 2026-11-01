#!/usr/bin/env node
/**
 * Manual rollback, run from GitHub Actions (Release → Run workflow → rollback-…).
 *
 *   rollback-app       Cloudflare keeps previous versions of the Worker and its static
 *                      files; `wrangler rollback` puts the previous one back live in seconds.
 *                      Safe on its own: every database version stays compatible with the
 *                      previous app version.
 *   rollback-database  Runs supabase/rollback/<newest migration>_down.sql through the
 *                      Supabase Management API. Destructive for data entered in the newest
 *                      version's new fields, so it requires ROLLBACK_CONFIRM=ROLLBACK.
 *                      Roll the app back first.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The newest migration that has a matching rollback script. */
export function rollbackPlan(migrationNames, rollbackNames) {
  const newest = [...migrationNames].sort().at(-1);
  if (!newest) throw new Error("No migrations found.");
  const down = newest.replace(/\.sql$/, "_down.sql");
  if (!rollbackNames.includes(down)) throw new Error(`No rollback script for ${newest} (expected supabase/rollback/${down}).`);
  return { migration: newest, script: down };
}

export async function rollback({ env, fetch, exec, log, summary, files }) {
  const target = env.ROLLBACK_TARGET;
  if (target === "rollback-app") {
    if (!env.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN secret is missing.");
    const out = exec("npx", ["wrangler", "rollback", "--yes", "--message", "Rollback from GitHub Actions"], {
      env: { ...process.env, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID ?? "", WRANGLER_SEND_METRICS: "false" },
    });
    log(String(out));
    summary("## Rollback\n\n- ✅ Previous app version is live again (Cloudflare Workers rollback). The database was not changed.");
    return "app-rolled-back";
  }
  if (target === "rollback-database") {
    if (env.ROLLBACK_CONFIRM !== "ROLLBACK") throw new Error('Type ROLLBACK in the "confirm" box to roll the database back.');
    if (!env.SUPABASE_ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN secret is missing.");
    const { url } = JSON.parse(files.publicConfig);
    const ref = new URL(url).hostname.split(".")[0];
    if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("config/public-supabase.json has no valid project URL.");
    const plan = rollbackPlan(files.migrations, files.rollbacks);
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: files.read(plan.script) }),
    });
    if (!res.ok) throw new Error(`Database rollback failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    summary(`## Rollback\n\n- ✅ Database rolled back: \`${plan.migration}\` undone with \`supabase/rollback/${plan.script}\`.\n- Next: set \`databaseVersion\` in config/public-supabase.json to the previous migration.`);
    return "database-rolled-back";
  }
  throw new Error(`Unknown rollback target "${target}".`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const list = (d) => (existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".sql")) : []);
  rollback({
    env: process.env,
    fetch: globalThis.fetch,
    exec: (cmd, args, opts) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }),
    log: (m) => console.log(m),
    summary: (md) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); console.log(md); },
    files: {
      publicConfig: readFileSync(join(ROOT, "config/public-supabase.json"), "utf8"),
      migrations: list("supabase/migrations"),
      rollbacks: list("supabase/rollback"),
      read: (name) => readFileSync(join(ROOT, "supabase/rollback", name), "utf8"),
    },
  })
    .then((r) => console.log(`Result: ${r}`))
    .catch((e) => {
      console.error(`::error::${e.message}`);
      process.exit(1);
    });
}
