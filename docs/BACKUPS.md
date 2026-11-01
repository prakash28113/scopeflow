# Backups

Supabase's free plan has no automatic backups, so ScopeFlow makes its own, for free, with GitHub Actions.

## What happens every week

`.github/workflows/backup.yml` runs every Sunday at 21:37 UTC (Monday 03:07 in India), and whenever you run it by hand (Actions → Backup → Run workflow). It:

1. Reads every table in the database: all of `public`, the sign-in accounts (`auth.users`, `auth.identities`) and the record of applied migrations. It uses the existing `SUPABASE_ACCESS_TOKEN` and read-only queries.
2. Compresses it and encrypts it with AES-256-GCM. The key comes from your `BACKUP_PASSPHRASE` through scrypt (N = 2¹⁷), with a new salt and IV every time. Any change to the file is detected when it's opened.
3. Proves the backup works. It decrypts the file and loads it into a fresh database built from the migrations, then checks that every row arrived. If anything fails, the run fails and GitHub emails you.
4. Keeps the encrypted file as a workflow artifact named `scopeflow-backup-YYYY-MM-DD` for 90 days, the longest GitHub allows. That gives about 13 weekly copies.

The repository is public. Signed-in GitHub users can download artifacts, which is why the file is encrypted before it's uploaded. The log shows only the number of tables and the file size, never any data. Without the passphrase, the file is useless.

## One-time setup (owner, on your phone)

1. Make a passphrase of at least 20 characters. Four or five random words plus a number work well, for example `river-lantern-copper-orbit-1987`. Don't reuse a password.
2. Save it in your password manager, and keep a second copy somewhere safe. **If you lose it, the backups can't be opened by anyone, including you.**
3. On GitHub, open the repository → Settings → Secrets and variables → Actions → New repository secret.
   - Name: `BACKUP_PASSPHRASE`
   - Secret: your passphrase
4. Actions → Backup → Run workflow. In about two minutes you should see a green tick and an artifact.

Never paste the passphrase into a chat, an issue or a commit.

## Restoring

Restoring should be rare: after data loss, an accidental deletion, or a move to a new Supabase project.

1. Download the artifact you want (Actions → Backup → pick a run → Artifacts). Unzip it to get the `.sfbk` file.
2. On a computer with this repository and Node 22:
   ```sh
   read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
   node scripts/backup/restore.mjs scopeflow-backup-2026-11-08.sfbk
   ```
   This writes two files next to the backup, and sends nothing anywhere:
   - `….json`: every row, readable. Use it to recover a single deleted record.
   - `….restore.sql`: loads everything into a database.
3. To restore a whole database:
   1. Create a new, empty Supabase project.
   2. Run a release against it, so it gets the same migrations. The backup names its database version, and the restore check uses the same version.
   3. Load the file:
      ```sh
      psql "<the new project's connection string>" -f scopeflow-backup-2026-11-08.restore.sql
      ```
   The load is one transaction: it either all goes in or nothing does. While it runs, triggers and foreign-key checks are paused, rows that already exist are skipped, and it prints how many rows each table received. Running it twice changes nothing.
4. Point the app at the new project (`config/public-supabase.json`) and release.

Don't restore over the live database without a fresh backup taken first.

## Limits

- Backups are weekly, so up to a week of changes can be lost. You can run the workflow by hand before risky work.
- Uploaded files aren't covered. ScopeFlow doesn't store any today.
- A backup is only useful together with its passphrase. Test that you can find yours.

## Tests

- `tests/db/backup.test.ts` checks:
  - export of every table;
  - wrong passphrase and tampering are rejected;
  - a restore into a fresh database comes back identical, and loading twice changes nothing;
  - the weekly restore check passes, and flags a table that doesn't load.
- The weekly run itself repeats the restore check on the real data, inside GitHub's runner.
