# Rollback plan — v1.1

Two independent levers, both run from **GitHub → Actions → Release → Run workflow** on `main`. Use the app rollback first; it is enough for almost every problem.

| | App rollback | Database rollback |
| --- | --- | --- |
| Action | `rollback-app` | `rollback-database` + type `ROLLBACK` in *confirm* |
| What it does | `wrangler rollback`: Cloudflare puts the previous Worker version and its static files back live | Runs `supabase/rollback/20261101000000_v1_1_agreement_down.sql`: restores the v1.0 functions, removes the v1.1 columns and indexes |
| Time | Seconds | Seconds |
| Data impact | None | Deletes exclusions, terms and extra-round prices entered since v1.1, and retry ids. Projects, links, approvals, revisions, change orders and payments stay. "Opened" events stay (activity log is immutable). |
| Needs | `CLOUDFLARE_API_TOKEN` (+ account id) | `SUPABASE_ACCESS_TOKEN` (Database write) |
| Safe alone? | Yes — the v1.0 app works against the v1.1 database (tested: old save payload keeps v1.1 fields; old 5-argument request call works) | Only after the app rollback — the v1.1 app needs the v1.1 columns |

## When to use which

- **Visual bug, broken page, wrong copy** → app rollback, fix forward, release again.
- **Database function misbehaving** (wrong revision counting, errors saving projects) → app rollback, then database rollback, then set `databaseVersion` in `config/public-supabase.json` back to `20261031000000_scopeflow_schema.sql` (the run summary reminds you).
- **Release run fails halfway** → nothing to roll back: the migration is one transaction (all or nothing), and the app is deployed only after every database step and check passes. Re-run after fixing.

## What has been verified

- Database rollback: tested on a v1.0 database with live data upgraded to v1.1 — rollback runs, runs again (idempotent), keeps the v1.0 link, approval fingerprint and revision counts working, and v1.1 re-applies afterwards (`tests/db/release-audit.test.ts`, `tests/db/v1-1.test.ts`).
- Rollback automation: confirmation required, newest migration's script chosen, correct API call (`tests/unit/rollback.test.ts`).
- **Not yet exercised against the real Cloudflare account**: `wrangler rollback` needs the Cloudflare secret, which doesn't exist yet. It's Cloudflare's standard command; the first real use will be visible in the run log. A safe first test after the release: run `rollback-app`, confirm v1.0 is back, then run `release` again.
