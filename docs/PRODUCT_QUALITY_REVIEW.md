# Product quality review — 15 November 2026

Base: `8cae200` on `main`. This review uses repository code and isolated automated tests. It does not certify production configuration or claim a new live browser pass.

## Confirmed issue and correction

A pending submit button could remain enabled when its caller passed `disabled={false}`. The caller's props overwrote the component's computed disabled state. Sign-in, signup, password-reset and settings password-change forms pass a CAPTCHA-related disabled prop, so a completed CAPTCHA could enable the button during the request.

Both the form action hook and the reusable action button also relied on React's next render to prevent another submission. Multiple events before that render could invoke the server operation twice.

The correction gives the computed pending state precedence and uses a synchronous per-instance in-flight guard. The guard releases after success, database error or network failure. Invalid input does not hold the guard. It does not change validation, CAPTCHA enforcement, authorization or database constraints. It prevents duplicate UI submissions; it does not promise server-side idempotency across tabs, reloads or network retries.

Regression tests exercise the actual component props and handlers, including a deferred server response, duplicate submissions, retries and the CAPTCHA-ready disabled override.

## Existing workflow coverage inspected

| Customer workflow | Existing automated coverage |
| --- | --- |
| Registration, login, logout, password reset | `tests/e2e/workflow.mjs`, `tests/e2e/captcha.mjs`, auth unit tests |
| Onboarding | browser walkthrough and `tests/db/workflow.test.ts` |
| Client creation and client records | browser walkthrough and database workflow/plan tests |
| Project creation, scope, quotation | browser walkthrough, validation/quote unit tests and database workflow tests |
| Approval links and revision limits | browser walkthrough, database workflow tests and PostgreSQL race suite |
| Change orders and client decisions | browser walkthrough and database workflow/GST tests |
| GST invoices and payment tracking | browser walkthrough and GST/payment database tests |
| Expenses and profit reporting | browser walkthrough and progress/expenses database tests |
| Notifications and follow-ups | browser walkthrough and notification/follow-up database tests |
| Subscriptions, plan limits and account settings | browser walkthrough, CAPTCHA pass, plan/billing database and unit tests |
| Error recovery and mobile portal | browser walkthrough/fixes scripts, error-message unit tests and new form submission tests |

These are coverage references, not proof that every real external service works. Email delivery, Google authentication, Razorpay and CAPTCHA are represented by controlled stand-ins in the local browser walkthrough. A production smoke test needs separate owner approval.

## Release gates

Before approving a production release, require green Verify, PostgreSQL concurrency and Browser walkthrough jobs on the exact PR head. Review the separate Supabase security audit and its migration/rollback prerequisites. Verify backup configuration and a restoration exercise using isolated infrastructure. Confirm the deployed schema matches the reviewed migrations, then obtain explicit owner approval for merge and deployment.

Do not interpret a historical checklist's “live” status as current production verification. No production database, account or deployment was changed in this review.

## Local validation

- TypeScript check: passed.
- Full unit/database suite: **592 tests in 74 files passed**, using one worker to fit the shared test host (317.79 seconds).
- New submission regressions: all five passed, including error and network retry paths.
- Production build and six public-page prerenders: passed with the repository's existing public Supabase configuration.
- Secret scan and dependency audit: passed.
- Time-zone runs: **356 unit tests in 46 files passed in each of Honolulu, Kiritimati and Kolkata**, using one worker. An earlier run with default workers hit `SIGKILL` under shared host memory pressure; all three bounded retries completed successfully. GitHub Actions checks remain required before release approval.
- Browser walkthrough and real PostgreSQL concurrency status must be attached from the exact PR head; this document does not claim they were rerun for this branch.
