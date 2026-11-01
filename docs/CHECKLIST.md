# ScopeFlow — Product checklist status

Audited 1 November 2026 against the live app (scopeflow.in) and the codebase, then updated after batches A–E (built 1 November, **not live yet**). Evidence comes from:

- 274 automated tests;
- 9 race tests on real PostgreSQL;
- the 35-step browser walkthrough, with a phone pass of every main screen;
- release smoke tests on the live site.

**Legend:**

| Status | Meaning |
|---|---|
| ✅ COMPLETE | Implemented, tested and live |
| 🟡 PARTIAL | Exists, needs improvement |
| ❌ MISSING | Not built yet |
| 🐞 BROKEN | Exists, but something is wrong |
| ⛔ BLOCKED | Waiting on a dependency |

## Phase 1 — Core scope protection

| Item | Status | Evidence / notes |
|---|---|---|
| Create and edit projects | ✅ | Validation, a draft/locked lifecycle, recall to edit |
| Budget, deadlines, payment terms | ✅ | Budget, start/due dates, payment milestones, terms |
| Deliverables and descriptions | ✅ | |
| Included / excluded work | ✅ | A "Not included" list, part of the approved version |
| Revision limits per deliverable | ✅ | |
| Additional revision charges | ✅ | Price per extra round, with a one-tap change order |
| Private client approval links | ✅ | 256-bit tokens; only a hash is stored; rate-limited |
| Approve / request changes without registration | ✅ | |
| Lock approved scope versions | ✅ | Immutable rows, protected by a database trigger, with a SHA-256 fingerprint |
| Approval history and timestamps | ✅ | Name, time, browser and IP; approval timeline |
| Detect vague or incomplete scope | ✅ | Scope checker |
| Track revisions used / remaining | ✅ | |
| Record revision requests | ✅ (A–E) | From the client link, or logged by you when it came by WhatsApp, call, email or a meeting: same scope check, same limits, race-tested, and the client sees it |
| Identify out-of-scope requests | ✅ | Automatic, race-tested |
| Create change orders | ✅ | Fixed or hourly |
| Extra charges and timeline extensions | ✅ | |
| Client approval before extra work | ✅ | Recorded with evidence |
| Complete change history | ✅ | Activity log and the Approval record PDF |
| Project dashboard | ✅ | |
| Project status and milestones | ✅ | Plus deliverable progress |
| Deliverable deadlines | ✅ (A–E) | Optional due date per deliverable: part of the approved scope, moved by change-order extensions, with late or due-soon tags and reminders |
| Activity timelines | ✅ | Filterable project timeline |
| Upcoming and overdue deadlines | ✅ | Dashboard Upcoming and Reminders, per project and (A–E) per deliverable |

## Phase 2 — Clients, quotations, invoices

| Item | Status | Evidence / notes |
|---|---|---|
| Create and edit client profiles | ✅ (A–E) | "Add client" on the Clients page (plan limits and duplicate check in the database); "New project for …" from the client page |
| Client contact details | ✅ | Email, phone, company, billing address, GSTIN, private notes |
| Client project history | ✅ | |
| Quotations and invoices by client | ✅ | |
| Repeat clients | ✅ | "Repeat client" tag; client reused by email |
| Client activity history | ✅ | Approval history and payment records |
| Professional quotations | ✅ | Printable quote |
| Services, quantities, pricing | 🟡 | Fixed price, or hours × rate. **No general "quantity × unit price"** (e.g. 10 posts × ₹500) |
| Discounts and taxes | ✅ | Discount %, GST (or any tax) |
| Quotation validity | ❌ | |
| Reusable quotation templates | 🟡 | Built-in templates only; **you can't save your own** |
| Share quotations with clients | ✅ | The client link shows the quote; print / PDF |
| Convert approved quotation into project | ✅ | By design: the quote *is* the project scope, and approval activates the project |
| Downloadable PDF quotations | 🟡 | Through the browser's "Save as PDF" (works on phone and desktop); **no one-tap PDF file** |
| Professional invoices | ✅ | GST tax invoice, locked numbering, UPI QR |
| Advance / milestone / final invoices | ✅ | One invoice per payment milestone |
| Paid and partially paid invoices | ✅ | |
| Outstanding amounts | ✅ | |
| Payment date and method | ✅ | |
| Downloadable PDF invoices | 🟡 | Same as quotes: browser Save as PDF |
| Payment history | ✅ | Per project, per client and in the approval record |
| Plan recurring invoice workflows | ❌ | Not planned yet (Phase 4) |

## Phase 3 — Expenses, analytics, notifications

| Item | Status | Evidence / notes |
|---|---|---|
| Record, categorise and link expenses to projects | ✅ | |
| Monthly expenses, estimated profit, revenue vs expenses | ✅ | |
| Monthly revenue dashboard, expenses, profit, received, outstanding | ✅ | |
| Active and completed projects | ✅ | |
| Average project value | ✅ | |
| Revenue trends and charts | ✅ (A–E) | 12-month chart; on phones the last 6 months at a readable size, with all 12 in the table |
| Client performance insights | ✅ | Top clients |
| Project performance insights | 🟡 | Progress only; **no per-project profit** (expenses are already linked to projects) |
| Date filters | 🟡 | Month and currency; **no quarter, financial year (Apr–Mar) or custom range** |
| Pending approval reminders | ✅ | After 3 days |
| Upcoming deadline reminders | ✅ | |
| Overdue invoice alerts | ✅ | |
| Pending payment reminders | ✅ | |
| Follow-up reminders | ✅ | |
| In-app notification centre | 🟡 | The bell shows client activity; Reminders are on the dashboard. **Not one place** |

## Phase 4 — Advanced (intentionally not started)

| Item | Status |
|---|---|
| Recurring invoices, retainers, advanced agreement workflows, automation, integrations | ❌ Deferred. Validate with real freelancers first |

## Quality, security and launch

| Item | Status | Evidence / notes |
|---|---|---|
| Fully responsive mobile | ✅ (A–E) | Bottom tab bar, jump links on the project page, and no main screen wider than the phone (the check now also catches the page widening itself) |
| Authentication and account recovery | ✅ | Email + password, reset by email (Brevo) |
| Google sign-in | ⛔ | Built; **waiting for your Google Client ID** |
| Database-level ownership and access controls | ✅ | RLS on all 24 tables, read-only to the app, writes only through checked functions; 5 public functions |
| Secure approval links / expiry / revocation | ✅ | |
| Input validation | ✅ | Both the app and the database |
| Error handling, loading and empty states | ✅ | |
| Automated tests / regression testing | ✅ | Every release re-runs all checks before deploying |
| No duplicate or inconsistent records | ✅ | Unique constraints, idempotency, race-tested |
| Database migrations tested | ✅ | Each re-runs safely and rolls back twice |
| Backup and rollback plan verified | ⛔ (A–E) | Weekly encrypted backup with a restore check on every run (docs/BACKUPS.md). **Waiting for you to add the `BACKUP_PASSPHRASE` secret** |
| Invite-only beta access verified | — | **Open by your decision (1 Nov)**. Invite-only mode still works and is tested |
| Privacy policy and terms reviewed | ✅ (A–E) | The privacy policy now covers business and client billing details, logged requests, invoices, payments, expenses, follow-ups and the encrypted backups |
| Production deployment readiness | ✅ | Live, with smoke tests on every release |

## Bugs and risks

Items marked "fixed" are fixed in batches A–E (not live yet).

1. ✅ Fixed: **Dashboard "Upcoming" showed a part-paid payment's full amount.** It now shows the balance.
2. ⛔ **No automatic database backups:** the weekly encrypted backup is built and tested, but it needs your `BACKUP_PASSPHRASE` secret.
3. ✅ Fixed: **The privacy policy was behind the features.**
4. ✅ Fixed: **Scope-creep gap.** Requests that arrive on WhatsApp, a call or email can now be logged.
5. ✅ Fixed (found during A–E): **The dashboard was wider than a phone screen** when a project title was long. Phones quietly zoomed out, so the old check missed it; the check is stricter now.
6. ℹ️ **Your email appears on invoices** sent to clients. This is normal for invoices and can be removed.
7. ℹ️ **Supabase Free:** 5 GB/month data transfer. Fine for now; check Usage weekly.
8. ℹ️ **The repository is public**, so backup files are downloadable by signed-in GitHub users. They're encrypted (AES-256-GCM) and the logs show no data. Making the repository private also works, within GitHub's free private-repo minutes.

## Mobile UX issues

All four are fixed in A–E (not live yet):

1. Dashboard totals: one line per currency.
2. Analytics chart: readable on a phone.
3. Long project page: sticky jump links (Scope · Requests · Payments · Timeline).
4. Main sections behind the ⋯ menu: bottom tab bar (Home, Clients, Invoices, Analytics, Settings).

## Recommended order (S = hours, M = about a day, L = several days)

| Batch | What | Size | Needs approval? |
|---|---|---|---|
| A ✅ | Fix: Upcoming balance bug; dashboard currency totals; phone-readable chart; privacy policy update | S | No |
| B ✅ | **Core:** log a client request received outside ScopeFlow (WhatsApp/call/email), counted against revision limits with a "how it arrived" note; standalone "Add client" | M | No |
| C ✅ | **Core:** deliverable due dates (form, progress, reminders, client page) | M | Database change |
| D ✅ | Phone navigation: bottom tab bar and jump links on the project page | M | No |
| E ✅ | Automatic encrypted weekly backups through GitHub Actions (free) | M | **Yes**: needs the `BACKUP_PASSPHRASE` secret, added by you (uses the existing Supabase token) |
| F | Quotes: "valid until", quantity × unit price lines, save your own templates | M | Database change |
| G | Analytics: per-project profit; quarter / financial-year / custom date filters; one notification centre | M | No |
| H | One-tap PDF download for quote, invoice and record (free library) | M | No |
| — | Phase 4 (recurring invoices, retainers, automation) | L | After real-freelancer validation |
