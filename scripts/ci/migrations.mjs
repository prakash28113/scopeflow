/**
 * Applying and undoing migrations safely. Pure functions (no network), tested in tests/unit/migrations.test.ts
 * and tests/db/migration-safety.test.ts.
 *
 * Why this exists: each migration file wraps itself in begin/commit. Wrapped a second time by the runner, the file's own
 * `commit` ended the transaction early and the history row was written OUTSIDE it, so a failed history insert left the
 * change in the database without a record (and a rollback left a record without the change). Now the runner owns the one
 * transaction: file → history row → commit, all or nothing, and a rollback removes the history row in the same transaction.
 */
import { createHash } from "node:crypto";

const NAME = /^[0-9]{14}_[a-z0-9_]+\.sql$/;
const LOCK = "select pg_advisory_xact_lock(hashtext('scopeflow_admin.migrations'));";
const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
/** A line that is only begin/commit (the file's own transaction), which the runner replaces with its own. */
const OWN_TXN = /^[ \t]*(begin|commit)([ \t]+transaction)?[ \t]*;[ \t]*$/gim;
/** Statements PostgreSQL refuses inside a transaction (or that must not run in one): apply those by hand. */
const NOT_TRANSACTIONAL = [/\bcreate\s+(unique\s+)?index\s+concurrently\b/i, /\bdrop\s+index\s+concurrently\b/i, /\breindex\b[^;]*\bconcurrently\b/i, /^[ \t]*vacuum\b/im, /\balter\s+system\b/i, /\bcreate\s+database\b/i, /\bdrop\s+database\b/i, /^[ \t]*(rollback|abort)[ \t]*;/im, /\bstart\s+transaction\b/i];

export const checksum = (body) => createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex");

/** The file's SQL without its own begin/commit; refuses anything that can't run inside the runner's transaction. */
export function prepare(name, body) {
  if (!NAME.test(name)) throw new Error(`Unexpected migration file name: ${name}`);
  const inner = body.replace(OWN_TXN, "");
  const bad = NOT_TRANSACTIONAL.find((re) => re.test(inner));
  if (bad) throw new Error(`${name} contains a statement that can't run inside a transaction (${bad.source}). Apply it by hand in the SQL Editor and record it in scopeflow_admin.applied_migrations; the runner won't half-apply it.`);
  return inner;
}

/** One transaction: lock → the migration → its history row → commit. Any failure undoes all of it. */
export function migrationSql(name, body) {
  return `begin;\n${LOCK}\n${prepare(name, body)}\ninsert into scopeflow_admin.applied_migrations (name, checksum) values (${quote(name)}, ${quote(checksum(body))});\ncommit;`;
}

/**
 * One transaction: lock → refuse unless this is the newest recorded migration → the rollback script → remove its
 * history row → commit. After it, the same migration can be applied again by the next release.
 */
export function rollbackSql(name, downBody) {
  const up = name;
  return `begin;\n${LOCK}
do $guard$ begin
  if not exists (select 1 from scopeflow_admin.applied_migrations where name = ${quote(up)}) then
    raise exception 'Migration % is not recorded as applied, so it was not rolled back.', ${quote(up)};
  end if;
  if exists (select 1 from scopeflow_admin.applied_migrations where name > ${quote(up)}) then
    raise exception 'A newer migration is recorded as applied; roll that one back first.';
  end if;
end $guard$;
${prepare(up, downBody)}
delete from scopeflow_admin.applied_migrations where name = ${quote(up)};
commit;`;
}

/**
 * Compares the database's history with the migration files.
 *   pending   files not applied yet, oldest first
 *   problems  stop the release: an applied migration's file was edited afterwards (checksums recorded since this fix)
 *   warnings  reported, release continues: history rows with no file, or a pending migration older than one already applied
 */
export function checkHistory(files, applied) {
  const byName = new Map(applied.map((a) => [a.name, a]));
  const pending = files.filter((f) => !byName.has(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const problems = [];
  const warnings = [];
  for (const f of files) {
    const a = byName.get(f.name);
    if (a?.checksum && a.checksum !== checksum(f.body))
      problems.push(`${f.name} was changed after it was applied. Leave applied migrations as they are and add a new migration for the change.`);
  }
  const names = new Set(files.map((f) => f.name));
  for (const a of applied) if (!names.has(a.name)) warnings.push(`${a.name} is recorded as applied but has no file in supabase/migrations.`);
  const newestApplied = applied.map((a) => a.name).sort().at(-1);
  for (const p of pending) if (newestApplied && p.name < newestApplied) warnings.push(`${p.name} is older than the newest applied migration (${newestApplied}); it will be applied now, out of order.`);
  return { pending, problems, warnings };
}
