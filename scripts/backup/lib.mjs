/**
 * Encrypted database backups: export → gzip → AES-256-GCM (key from the passphrase via scrypt),
 * and the way back: decrypt → SQL that loads the rows into a fresh database.
 * Node built-ins only. Tested in tests/db/backup.test.ts.
 *
 * File format (.sfbk):
 *   "SFBK" | version 1 (1 byte) | log2 N, r, p (3 bytes) | salt (16) | iv (12) | tag (16) | ciphertext
 * The 36-byte header before the tag is authenticated too (GCM additional data), so nothing in it
 * can be altered without the decryption failing.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const FORMAT = "scopeflow-backup/1";
export const MIN_PASSPHRASE = 20;
const MAGIC = Buffer.from("SFBK");
const SCRYPT = { logN: 17, r: 8, p: 1 };
const PAGE = 1000;

/** The tables a backup holds: everything in public, ScopeFlow's migration record, and the sign-in accounts. */
export const TABLES_SQL = `select table_schema as s, table_name as t
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and (table_schema in ('public', 'scopeflow_admin') or (table_schema = 'auth' and table_name in ('users', 'identities')))
 order by case table_schema when 'auth' then 0 when 'public' then 1 else 2 end, table_name`;

const ident = (name) => `"${String(name).replaceAll('"', '""')}"`;

export function checkPassphrase(pass) {
  if (!pass) throw new Error("No backup passphrase. Add the BACKUP_PASSPHRASE secret (see docs/BACKUPS.md).");
  if (pass.length < MIN_PASSPHRASE) throw new Error(`The backup passphrase must be at least ${MIN_PASSPHRASE} characters.`);
}

/**
 * Reads every row. `sql(query)` returns an array of row objects (the Supabase query endpoint, or a test database).
 * Returns { format, created_at, migrations, tables: { "schema.table": rows[] } }.
 */
export async function exportDatabase(sql, now = new Date()) {
  const tables = {};
  for (const { s, t } of await sql(TABLES_SQL)) {
    const name = `${s}.${t}`;
    const [{ n }] = await sql(`select count(*)::int as n from ${ident(s)}.${ident(t)}`);
    const rows = [];
    for (let offset = 0; offset < n; offset += PAGE) {
      const [page] = await sql(
        `select coalesce(json_agg(x), '[]'::json) as rows from (select * from ${ident(s)}.${ident(t)} order by 1 limit ${PAGE} offset ${offset}) x`,
      );
      const got = typeof page.rows === "string" ? JSON.parse(page.rows) : page.rows;
      rows.push(...got);
    }
    if (rows.length !== n) throw new Error(`${name}: expected ${n} rows, read ${rows.length} (rows changed during the backup?)`);
    tables[name] = rows;
  }
  const migrations = (tables["scopeflow_admin.applied_migrations"] ?? []).map((r) => r.name).sort();
  return { format: FORMAT, created_at: now.toISOString(), migrations, tables };
}

export function encrypt(plain, pass, { salt = randomBytes(16), iv = randomBytes(12) } = {}) {
  checkPassphrase(pass);
  const header = Buffer.concat([MAGIC, Buffer.from([1, SCRYPT.logN, SCRYPT.r, SCRYPT.p]), salt, iv]);
  const key = scryptSync(pass, salt, 32, { N: 2 ** SCRYPT.logN, r: SCRYPT.r, p: SCRYPT.p, maxmem: 512 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), body]);
}

export function decrypt(file, pass) {
  if (file.length < 52 || !file.subarray(0, 4).equals(MAGIC)) throw new Error("Not a ScopeFlow backup file.");
  if (file[4] !== 1) throw new Error(`Unsupported backup file version ${file[4]}.`);
  const [logN, r, p] = [file[5], file[6], file[7]];
  if (logN < 14 || logN > 22 || r < 1 || r > 32 || p < 1 || p > 16) throw new Error("Backup file header is damaged.");
  const header = file.subarray(0, 36);
  const salt = file.subarray(8, 24);
  const iv = file.subarray(24, 36);
  const tag = file.subarray(36, 52);
  const key = scryptSync(pass, salt, 32, { N: 2 ** logN, r, p, maxmem: 2 ** logN * r * 256 + 64 * 1024 * 1024 });
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(52)), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase, or the backup file is damaged.");
  }
}

/** Backup object → encrypted file bytes. */
export function pack(backup, pass) {
  return encrypt(gzipSync(Buffer.from(JSON.stringify(backup))), pass);
}

/** Encrypted file bytes → backup object. */
export function unpack(file, pass) {
  const backup = JSON.parse(gunzipSync(decrypt(file, pass)).toString("utf8"));
  if (backup.format !== FORMAT) throw new Error(`Unknown backup format ${backup.format}.`);
  return backup;
}

export function summary(backup) {
  const counts = Object.fromEntries(Object.entries(backup.tables).map(([k, rows]) => [k, rows.length]));
  return { created_at: backup.created_at, migration: backup.migrations.at(-1) ?? null, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

/**
 * SQL that loads a backup into a database where the same migrations have already been applied.
 * One transaction; triggers and foreign-key checks are paused while loading (session_replication_role),
 * generated columns are skipped, rows that already exist are left alone, and tables the target doesn't have are reported.
 */
export function restoreSql(backup) {
  const parts = [
    `-- ScopeFlow backup from ${backup.created_at}, database version ${backup.migrations.at(-1) ?? "unknown"}.`,
    "-- Load into a database with the same migrations applied (see docs/BACKUPS.md).",
    "begin;",
    "set local session_replication_role = replica;",
    `create or replace function pg_temp.sf_restore(p_table text, p_rows jsonb) returns text language plpgsql as $fn$
declare
  t regclass := to_regclass(p_table);
  cols text;
  n int;
begin
  if t is null then return p_table || ': skipped (not in this database)'; end if;
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
    from pg_attribute where attrelid = t and attnum > 0 and not attisdropped and attgenerated = '';
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1) on conflict do nothing', t, cols, cols, t) using p_rows;
  get diagnostics n = row_count;
  return p_table || ': ' || n || ' of ' || jsonb_array_length(p_rows) || ' rows';
end $fn$;`,
  ];
  for (const [name, rows] of Object.entries(backup.tables)) {
    if (!rows.length) continue;
    const json = JSON.stringify(rows);
    let tag = "sf";
    while (json.includes(`$${tag}$`)) tag = `sf${randomBytes(4).toString("hex")}`;
    const [s, t] = name.split(".");
    parts.push(`select pg_temp.sf_restore(${quoteLiteral(`${ident(s)}.${ident(t)}`)}, $${tag}$${json}$${tag}$::jsonb);`);
  }
  parts.push("commit;");
  return parts.join("\n") + "\n";
}

const quoteLiteral = (v) => `'${String(v).replaceAll("'", "''")}'`;
