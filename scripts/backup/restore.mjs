#!/usr/bin/env node
/**
 * Open a ScopeFlow backup.
 *   read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
 *   node scripts/backup/restore.mjs scopeflow-backup-2026-11-08.sfbk
 * Writes, next to the file:
 *   <name>.json         every row, readable
 *   <name>.restore.sql  loads the rows into a database that has the same migrations applied
 *   <name>.storage/     the blog images, as files (checked against their checksums), when the backup holds any
 * Nothing is sent anywhere. See docs/BACKUPS.md for restoring into a new Supabase project.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { restoreSql, summary, unpack } from "./lib.mjs";
import { restoreStorage, storageManifest } from "./storage.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: BACKUP_PASSPHRASE=… node scripts/backup/restore.mjs <backup.sfbk>");
  process.exit(2);
}
try {
  const backup = unpack(readFileSync(path), process.env.BACKUP_PASSPHRASE ?? "");
  const base = path.replace(/\.sfbk$/, "");
  const { storage, ...rest } = backup;
  writeFileSync(`${base}.json`, JSON.stringify({ ...rest, storage: storage ? storageManifest(storage) : undefined }, null, 2));
  writeFileSync(`${base}.restore.sql`, restoreSql(backup));
  const s = summary(backup);
  console.log(`Backup from ${s.created_at} (database version ${s.migration ?? "unknown"}): ${s.tables} tables, ${s.rows} rows.`);
  for (const [t, n] of Object.entries(s.counts)) console.log(`  ${t.padEnd(40)} ${n}`);
  console.log(`Wrote ${base}.json and ${base}.restore.sql`);
  if (storage && Object.values(storage.buckets).some((b) => b.objects.length)) {
    const r = restoreStorage(backup, `${base}.storage`);
    console.log(`Wrote ${r.files} image file(s) (${r.bytes} bytes, checksums verified) to ${r.dir}. Upload them to the bucket yourself: see docs/RECOVERY.md.`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
