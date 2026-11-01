#!/usr/bin/env node
/**
 * Open a ScopeFlow backup.
 *   read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
 *   node scripts/backup/restore.mjs scopeflow-backup-2026-11-08.sfbk
 * Writes, next to the file:
 *   <name>.json         every row, readable
 *   <name>.restore.sql  loads the rows into a database that has the same migrations applied
 * Nothing is sent anywhere. See docs/BACKUPS.md for restoring into a new Supabase project.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { restoreSql, summary, unpack } from "./lib.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: BACKUP_PASSPHRASE=… node scripts/backup/restore.mjs <backup.sfbk>");
  process.exit(2);
}
try {
  const backup = unpack(readFileSync(path), process.env.BACKUP_PASSPHRASE ?? "");
  const base = path.replace(/\.sfbk$/, "");
  writeFileSync(`${base}.json`, JSON.stringify(backup, null, 2));
  writeFileSync(`${base}.restore.sql`, restoreSql(backup));
  const s = summary(backup);
  console.log(`Backup from ${s.created_at} (database version ${s.migration ?? "unknown"}): ${s.tables} tables, ${s.rows} rows.`);
  for (const [t, n] of Object.entries(s.counts)) console.log(`  ${t.padEnd(40)} ${n}`);
  console.log(`Wrote ${base}.json and ${base}.restore.sql`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
