# v1.1 production-readiness audit

Commit audited: `0d51602` on `main`. Evidence: [CI run 41285068775](https://github.com/prakash28113/scopeflow/actions/runs/41285068775) (all green) and the reports in this folder.

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Migrations backward compatible and safe to re-run | ✅ after fixes | v1.1 applied twice → identical schema; v1.0 app payloads and calls work on v1.1; every later migration linted for IF NOT EXISTS. v1.0's base schema is install-once by design, guarded by the release's applied-migrations record and an "already installed" refusal. |
| 2 | Approved agreement versions immutable | ✅ | Superuser updates/deletes of snapshots and decisions rejected by triggers; locked scope and terms can't be edited or re-sent; fingerprint re-verified |
| 3 | Revision counts can't be duplicated by retries or concurrency | ✅ after fixes | Request id makes retries idempotent; unique index on included numbers; 8 parallel requests and 8 parallel retries on real PostgreSQL |
| 4 | Change-order rejection doesn't alter the agreement | ✅ | Budget, extras, due date, extra days, status, terms, milestones and snapshot hashes identical before/after; a rejected order can't be approved later |
| 5 | All operations enforce RLS and ownership | ✅ | 14/14 tables RLS, 0 directly writable; 22 privileged functions all pinned and guarded; 0 executable by PUBLIC — PERMISSION_AUDIT.md |
| 6 | Payment and deadline calculations across time zones | ✅ after fix | Calendar dates fixed in every zone; timestamps now in the viewer's zone; unit suite run in UTC−10, UTC+14 and India |
| 7 | Rollback for database and frontend | ✅ database tested; app rollback scripted | ROLLBACK_PLAN.md — `wrangler rollback` itself not yet run against the real account (no credentials yet) |
| 8 | Existing projects and client links keep working | ✅ | Upgrade test with a live approved project: link, fingerprint, decision and revision count intact |
| 9 | All checks and the walkthrough run in the release pipeline | ✅ | 156 tests + 3×70 time-zone runs + permission audit + 4 concurrency checks + 22-step walkthrough, on every push and before every release — TEST_REPORT.md |

Reports: [TEST_REPORT.md](TEST_REPORT.md) · [MIGRATION_DIFF.md](MIGRATION_DIFF.md) · [PERMISSION_AUDIT.md](PERMISSION_AUDIT.md) · [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) · [ROLLBACK_PLAN.md](ROLLBACK_PLAN.md)
