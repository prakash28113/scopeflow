# Deployment plan — v1.1

**Status: waiting for the owner's approval. Nothing has been deployed and no production data has been changed.**
Sign-ups stay invite-only; the public launch is a separate, later approval (see the end).

## 1. Credentials (owner, once — never through chat)

Add these in GitHub: **github.com/prakash28113/scopeflow → Settings → Secrets and variables → Actions → New repository secret**.
On a phone, open the page in Chrome with **⋮ → Desktop site** turned on; the mobile layout hides Settings.

| Secret | Create it at | Least privilege |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → avatar → Account preferences → **Access Tokens → Generate new token** | Limit it to the **scopeflow-beta** project if offered. Permissions: **Database → read & write** only. Optional: **Auth configuration → write** (without it, the release leaves sign-in settings as they are and says so). Shortest expiry that covers the release. |
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → My Profile → **API Tokens → Create Token → Create Custom Token** | Permission **Account → Workers Scripts → Edit**; Account resources: **Include → your account only**; no zone permissions; set an end date. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right sidebar *Account ID* | Not secret, but stored here so the token needs no account-listing permission. |

The public Supabase URL and publishable key are already in `config/public-supabase.json`, so the Supabase token doesn't need project-read or API-key permissions.

**Also:** delete every token that was ever pasted into a chat (Supabase Access Tokens page; Cloudflare API Tokens page). They are not used by anything.

## 2. Pre-release checklist (already done)

- [x] CI green on `main`: 156 unit/database tests, unit suite in 3 time zones, permission audit, 4 real-Postgres concurrency checks, 22-step browser walkthrough ([run 41285068775](https://github.com/prakash28113/scopeflow/actions/runs/41285068775)).
- [x] Migration is additive, re-runnable and backward compatible; rollback script tested (twice in a row, then forward again).
- [x] Deploy job runs only on a manual *Run workflow* on `main`.
- [ ] Owner approval.
- [ ] Optional backup: Supabase Free has no automatic backups. For the beta (a handful of rows), export the `projects` table from Supabase → Table Editor → *Export to CSV*. The pipeline deliberately doesn't export data: artifacts on a public repository can be downloaded by any GitHub user.

## 3. Release (owner taps one button)

**GitHub → Actions → Release → Run workflow → Branch `main`, action `release` → Run workflow.**

What runs, in order (≈ 4 minutes; any failure stops everything after it):

1. All checks again on that exact commit: verify, time zones, permission audit, concurrency, browser walkthrough.
2. Database: creates the private `scopeflow_admin.applied_migrations` record if missing, applies **only** `20261101000000_v1_1_agreement.sql` in one transaction (all or nothing), records it.
3. Security check on the live database: 14 tables, RLS on all, exactly 5 public functions, sign-up trigger present.
4. Sign-in settings (if the token allows) and the invite list from `config/beta-allowlist.txt` (invite-only).
5. Build with the public settings, pre-deploy check (no placeholders, no secrets), `wrangler deploy` to the same Worker and address.
6. Live smoke tests: security headers, private client page, database health, fake links rejected, anonymous visitors can't read project data.

The run's **Summary** lists each result. Existing users with the v1.0 app open keep working during and after the switch (tested).

## 4. After the release

- I set `databaseVersion` in `config/public-supabase.json` to the v1.1 migration (so later app-only releases are allowed).
- Owner check on the phone (5 minutes): create a project with exclusions and an extra-round price → send → open the link in a private tab → see *Opened by client* on the project → approve → request revisions until the extra-round price appears.
- Keep or delete the secrets. With expiry dates set, keeping them is reasonable; deleting them means re-adding before the next release.

## 5. Public launch (separate approval, not part of this release)

Change `config/beta-allowlist.txt` to a single `*` line, commit, and run the release again (or, without a token, run `delete from public.beta_allowlist;` in the Supabase SQL Editor). Confirm the support email shown on the site first.
