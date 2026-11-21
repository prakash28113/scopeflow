# Recovery and release safety

What is protected, what is not, and the exact steps when something breaks. Nothing here needs a new paid service.

## 1. Supabase token (`SUPABASE_ACCESS_TOKEN`)

The release, the daily backup and the database rollback all use this one GitHub secret. If Supabase answers **401** the token is expired, revoked or mistyped; **403** means it is valid but cannot reach the project. Every script now runs a harmless read-only check first and stops with that explanation before changing or reading anything. Busy or slow answers (429, 5xx, timeouts) are retried three times and reported as "Supabase didn't answer", never as a token problem. Messages never contain the token or Supabase's reply.

Fix (account owner only, never in chat):
1. Supabase → Account → Access Tokens → create a token. The account must be a member of the project's organisation.
2. GitHub → repository Settings → Secrets and variables → Actions → replace `SUPABASE_ACCESS_TOKEN`.
3. Also check Settings → Environments → `production`: the backup and release jobs run in that environment, and an environment secret of the same name **overrides** the repository one. Replace it there too, or delete it so the repository secret applies.
4. Run Actions → Backup → Run workflow. Green means the token works. Then re-run the release.

## 2. Daily encrypted backup

Runs every day (`.github/workflows/backup.yml`). Steps: access check → read every table → compress and encrypt (AES-256-GCM, scrypt key from `BACKUP_PASSPHRASE`) → check the file's own **manifest** (row count and SHA-256 per table) → load it into a fresh database built from the migrations → upload the encrypted file (90 days). Any failure fails the run, uploads nothing, and writes the reason on the run page. Every release summary also says whether the latest backup succeeded.

**Covers:** all `public` tables, ScopeFlow's migration history, sign-in accounts (`auth.users`, `auth.identities`), and **Storage**: every object in the public `blog` bucket (blog images), kept in the same encrypted file with its size and SHA-256. Images are read from their public URLs, so no new secret is needed. The backup fails (and saves nothing) if an object can't be read, its size differs from what Storage lists, the bucket stops being public, or Storage exceeds 150 MB. After encryption, the job restores the images into a throwaway folder and checks every file against its checksum, and warns about images that blog posts use but Storage no longer holds.
**Does not cover (known gaps):**
- Schema, functions, triggers, row-level-security policies, extensions and grants are **rebuilt from `supabase/migrations`**, not from the backup file. This is why a restore needs the same migrations applied first.
- Sessions, auth logs and other Supabase-internal data.

**RPO** (data you can lose): up to 24 hours. **RTO** (time to recover): not measured on production; the restore step below is the whole procedure. Treat any time estimate as unverified until a real restore drill is done.

Restore: see `docs/BACKUPS.md` (decrypt with `scripts/backup/restore.mjs`, load into a database that has the same migrations). Never restore into a public or shared database.

## 3. Migrations

Each migration file runs in **one transaction together with its history row** (`scopeflow_admin.applied_migrations`), under a lock so two releases can't interleave. If any statement fails, or the history row can't be written, nothing is kept. Files that contain their own `begin`/`commit` are handled (the runner owns the transaction). A migration that cannot run in a transaction (`create index concurrently`, `vacuum`, …) is refused with instructions to apply it by hand.

Each applied migration stores a SHA-256 of its file. If an applied migration's file is later edited, the release stops: add a new migration instead. Older history rows have no checksum and are not compared. History rows with no file, or an old migration that is only now pending, are reported as warnings in the release summary.

## 4. Rolling back

1. **App:** Actions → Release → Run workflow → `rollback-app`. Safe on its own.
2. **Database** (only if needed, and only after the app rollback): `rollback-database`, type `ROLLBACK`. It undoes the **newest** migration with its `supabase/rollback/<name>_down.sql` and removes its history row **in the same transaction**. It refuses if that migration is not recorded, or if a newer one is. It destroys data in the undone migration's new fields.
3. Set `databaseVersion` in `config/public-supabase.json` to the previous migration.
4. To try again: fix, merge, release. The next release sees the migration as pending and applies it again.

Prefer a new forward migration that corrects the problem when a rollback would delete data.

## 5. Release gate and checklist

**A release will not start** unless the latest Backup run on main succeeded, finished within 36 hours, and still has its encrypted artifact (not expired, over 1 KB). The check runs before any database change and fails closed: if GitHub can't be asked, the release stops. The fix is always: run Actions → Backup, wait until it is green, release again. In a real emergency the owner can type `RELEASE WITHOUT FRESH BACKUP` in the release form's `backup_override` box; the release summary then says the gate was overridden. Rollbacks are never gated.

Checklist:
- [ ] CI green: verify, PostgreSQL concurrency, browser walkthrough.
- [ ] Backup gate passed (first lines of the release summary).
- [ ] `SUPABASE_ACCESS_TOKEN` accepted (the release's first step passes).
- [ ] Migration history check: no problems.
- [ ] After release: live checks pass in the release log.

## 6. Open decisions for the owner

- If a Storage bucket ever becomes private, or Storage grows past 150 MB, the backup stops with a message. Decide then between a service key (GitHub secret) or a second backup destination.
- Uploading restored images back to a live bucket is manual by design.
- A restore drill into a throwaway Supabase project, to measure the real RTO.
