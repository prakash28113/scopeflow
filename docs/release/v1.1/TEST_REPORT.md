# Test report — v1.1 release candidate

**Source:** GitHub Actions run [41285068775](https://github.com/prakash28113/scopeflow/actions/runs/41285068775) on commit `0d51602`, 1 Nov 2026, `ubuntu-24.04`, Node 22. All jobs green; deploy and rollback jobs correctly **skipped** (they run only on a manual *Run workflow*).

| Job | Result | Time |
| --- | --- | --- |
| Verify: type check, unit + database tests, secret scan, dependency audit | ✅ 156 / 156 tests, 16 files | 1 min 23 s |
| Unit suite in three time zones (Pacific/Honolulu UTC−10, Pacific/Kiritimati UTC+14, Asia/Kolkata) | ✅ 70 / 70 in each zone | included above |
| Permission audit (catalog report, fails the job on any finding) | ✅ 0 findings — see PERMISSION_AUDIT.md | included above |
| Concurrency on real PostgreSQL 17.5 (separate connections) | ✅ 4 / 4 | 10 s |
| Browser walkthrough on Cloudflare's runtime (workerd) with Chrome | ✅ 22 / 22 steps, no browser errors | 58 s |

The walkthrough has **22 steps**; an earlier message of mine said 23, which was a miscount.

## Unit and database tests (156)

| File | Tests | What it covers |
| --- | --- | --- |
| tests/db/workflow.test.ts | 42 | Full workflow, scope checks, pricing, immutability, RLS isolation, tokens, portal abuse limits, notifications |
| tests/db/permissions.test.ts | 15 | Every table, policy and function grant from the catalog |
| tests/db/release-audit.test.ts | 12 | The readiness checks below (upgrade, re-run, compatibility, immutability, retries, change-order rejection, guards, rollback) |
| tests/db/v1-1.test.ts | 8 | Agreement fields, fingerprint, locking, permissions, "viewed", extra rounds, rollback |
| tests/db/release-sql.test.ts | 7 | Release automation SQL against the real schema |
| tests/db/rollback.test.ts | 2 | Full teardown and reinstall; auth trigger restore |
| tests/unit/release-deploy.test.ts | 13 | Release automation: waiting states, least-privilege token, pending-migration guard, live checks |
| tests/unit/v1-1.test.ts | 12 | Scope checker, form conversion, revision labels, upcoming dates |
| tests/unit/money-pricing.test.ts | 9 | Money parsing, pricing (cross-checked against Postgres rounding) |
| tests/unit/timezones.test.ts | 8 | Calendar dates vs moments at midnight in UTC−10 … UTC+14 |
| tests/unit/validation.test.ts | 8 | Form validation |
| tests/unit/security.test.ts | 7 | Redirect safety, error filtering, Worker fallback and headers |
| tests/unit/security-headers.test.ts | 5 | CSP with and without Turnstile |
| tests/unit/rollback.test.ts | 3 | Rollback automation (app and database paths) |
| tests/unit/portal-rpc.test.ts | 3 | Portal error mapping |
| tests/unit/secret-scan.test.ts | 2 | Secret scanner |

## Concurrency (tests/concurrency/race.mjs)

```
✓ 8 simultaneous revision requests: exactly the 2 included rounds are numbered 1 and 2
✓ 8 simultaneous retries of one submission: recorded once
✓ simultaneous approve and reject of one scope version: exactly one decision
✓ a change order approved twice at once adds its price once
All 4 concurrency checks passed on real PostgreSQL (postgres (PostgreSQL) 17.5)
```

## Browser walkthrough (tests/e2e/workflow.mjs)

```
• landing + sign up (no email confirmation)
• onboarding
• project form validation + create          (incl. scope check, exclusions, extra-round price, terms)
• send scope v1 → one-time link dialog
• client (phone) requests changes           (sees Not included / extra-round price / terms)
• freelancer sees notification, revises, resends (existing link reused)   (incl. "Opened by client")
• client approves v2
• dashboard shows upcoming payment dates
• client requests revisions — third exceeds the limit   (extra-round price shown up front)
• freelancer proposes an hourly change order (extra-round price pre-fills)
• client approves the change order
• freelancer records a payment
• in-app notifications
• client sees payment + history
• security: replaced link stops working immediately
• security: revoke
• security: malformed links
• security: another account can't see the project
• security: signed-out access redirects to sign-in
• sign out / sign in again
• mobile freelancer view
• rate limit: 20 failed link lookups lock out the IP, even for a valid link
✓ end-to-end workflow passed with no browser errors
```

## Issues found and fixed during this audit

| Finding | Fix | Proven by |
| --- | --- | --- |
| A retried or double-tapped change request could use up two included revisions | Optional request id per submission, recorded once; unique index on included revision numbers | release-audit "retries", concurrency checks 1–2 |
| A v1.0 app tab saving a draft would have cleared the new v1.1 fields | `save_project` keeps fields the caller doesn't send | release-audit "v1.0 app keeps working" |
| The v1.1 migration failed if run twice | `IF NOT EXISTS` everywhere; lint-style test on every later migration | release-audit "re-run" |
| Payment and approval timestamps were shown in UTC, so near midnight they showed the wrong day in India | Moments shown in the viewer's zone; calendar dates unchanged | timezones.test.ts |
| A replaced function would have been executable by PUBLIC (Postgres default) | Explicit `revoke … from public` | permissions.test.ts |
| A push to main could deploy automatically once secrets existed | Deploy and rollback run only on manual *Run workflow* | workflow file |
