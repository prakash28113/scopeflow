#!/usr/bin/env node
/**
 * Daily encrypted backup (run by .github/workflows/backup.yml).
 *   SUPABASE_ACCESS_TOKEN  the existing release token (Database access to this project)
 *   BACKUP_PASSPHRASE      a long passphrase only the owner knows (GitHub secret)
 * Reads every table through Supabase's database query endpoint, writes backup/scopeflow-backup-<date>.sfbk,
 * then proves it: decrypts the file and loads it into a fresh database built from the migrations.
 * This repository is public, so the log shows no data — only how many tables and the file size.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { checkPassphrase, exportDatabase, pack, restoreSql, summary, unpack } from "./lib.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const env = process.env;

async function main() {
  checkPassphrase(env.BACKUP_PASSPHRASE);
  if (!env.SUPABASE_ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is not available to this workflow.");
  const config = JSON.parse(readFileSync(join(ROOT, "config/public-supabase.json"), "utf8"));
  const ref = new URL(config.url).hostname.split(".")[0];
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("Unexpected Supabase project reference.");

  const sql = async (query) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, read_only: true }),
      });
      if (res.ok) return res.json();
      // Never echo the response body: on a public repository the log is public.
      if (attempt >= 3 || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`Supabase query failed (${res.status}).`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  };

  const backup = await exportDatabase(sql);
  const file = pack(backup, env.BACKUP_PASSPHRASE);
  const name = `scopeflow-backup-${backup.created_at.slice(0, 10)}.sfbk`;
  mkdirSync(join(ROOT, "backup"), { recursive: true });
  writeFileSync(join(ROOT, "backup", name), file);
  const s = summary(backup);
  console.log(`Encrypted backup written: ${s.tables} tables, ${(file.length / 1024).toFixed(1)} KB.`);

  // Prove it can be restored: decrypt with the passphrase and load into a fresh database with the same migrations.
  const restored = unpack(readFileSync(join(ROOT, "backup", name)), env.BACKUP_PASSPHRASE);
  const problems = await verifyRestore(restored);
  if (problems.length) throw new Error(`Restore check failed for ${problems.length} table(s): ${problems.join(", ")}`);
  console.log("Restore check passed: row counts and foreign-key relationships verified in a fresh database built from the migrations.");

  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `file=backup/${name}\nname=${name.replace(/\.sfbk$/, "")}\n`);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Daily backup\n\n- ✅ Encrypted backup: ${s.tables} tables, ${(file.length / 1024).toFixed(1)} KB\n- ✅ Restore check passed (fresh database, same migrations)\n- Kept for 90 days as a workflow artifact. Only the passphrase holder can read it.\n`);
}

/** Loads into isolated PostgreSQL (PGlite); returns row-count and foreign-key problems. */
export async function verifyRestore(backup) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(readFileSync(join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
  const dir = join(ROOT, "supabase/migrations");
  const upTo = backup.migrations.at(-1);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (upTo && f > upTo) break;
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  await db.exec("create schema if not exists scopeflow_admin; create table if not exists scopeflow_admin.applied_migrations (name text primary key, applied_at timestamptz not null default now());");
  const results = await db.exec(restoreSql(backup));
  const lines = results.flatMap((r) => r.rows.map((row) => String(Object.values(row)[0])));
  const problems = [];
  for (const [name, rows] of Object.entries(backup.tables)) {
    if (!rows.length) continue;
    const [s, t] = name.split(".");
    const ok = await db.query(`select to_regclass($1) is not null as present`, [`"${s}"."${t}"`]);
    if (!ok.rows[0].present) {
      if (s !== "auth") problems.push(`${name} (missing)`); // the test stand-in has only part of Supabase's auth schema
      continue;
    }
    const { rows: [{ n }] } = await db.query(`select count(*)::int as n from "${s}"."${t}"`);
    if (n !== rows.length) problems.push(`${name} (${n}/${rows.length})`);
  }
  // Restore intentionally pauses FK triggers so tables can load in any order.
  // Recheck their relationships explicitly: VALIDATE CONSTRAINT would skip
  // already-validated constraints, even when rows were loaded with triggers off.
  // Separate export requests can observe writes at different moments, so matching
  // row counts alone cannot prove that the restored database is usable.
  const { rows: foreignKeys } = await db.query(`
    select ns.nspname as schema, child.relname as table, fk.conname as name,
           pns.nspname as parent_schema, parent.relname as parent_table,
           fk.confmatchtype as match,
           array_agg(ca.attname::text order by cols.ordinality) as columns,
           array_agg(pa.attname::text order by cols.ordinality) as parent_columns
      from pg_constraint fk
      join pg_class child on child.oid = fk.conrelid
      join pg_namespace ns on ns.oid = child.relnamespace
      join pg_class parent on parent.oid = fk.confrelid
      join pg_namespace pns on pns.oid = parent.relnamespace
      cross join lateral unnest(fk.conkey, fk.confkey) with ordinality as cols(child_attnum, parent_attnum, ordinality)
      join pg_attribute ca on ca.attrelid = child.oid and ca.attnum = cols.child_attnum
      join pg_attribute pa on pa.attrelid = parent.oid and pa.attnum = cols.parent_attnum
     where fk.contype = 'f' and ns.nspname in ('public', 'auth', 'scopeflow_admin')
     group by ns.nspname, child.relname, fk.conname, pns.nspname, parent.relname, fk.confmatchtype
  `);
  const ident = (value) => `"${value.replaceAll('"', '""')}"`;
  for (const fk of foreignKeys) {
    const child = fk.columns.map((col) => `c.${ident(col)}`);
    const present = child.map((col) => `${col} is not null`).join(' and ');
    const matches = child.map((col, i) => `p.${ident(fk.parent_columns[i])} = ${col}`).join(' and ');
    const missing = `((${present}) and not exists (select 1 from ${ident(fk.parent_schema)}.${ident(fk.parent_table)} p where ${matches}))`;
    const mixedNulls = fk.match === 'f' ? ` or ((${child.map((col) => `${col} is null`).join(' or ')}) and (${child.map((col) => `${col} is not null`).join(' or ')}))` : '';
    const { rows: [{ invalid }] } = await db.query(`select exists (select 1 from ${ident(fk.schema)}.${ident(fk.table)} c where ${missing}${mixedNulls}) as invalid`);
    if (invalid) problems.push(`${fk.schema}.${fk.table} (foreign key ${fk.name})`);
  }
  await db.close();
  return Object.assign(problems, { lines });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.log(`::error::${e.message}`);
    process.exit(1);
  });
}
