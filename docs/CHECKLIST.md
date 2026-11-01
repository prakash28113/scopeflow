# ScopeFlow — Product checklist status

Audited 1 November 2026 against the live app (scopeflow.in) and the codebase. Evidence comes from:

- 260 automated tests;
- 8 race tests on real PostgreSQL;
- the 34-step browser walkthrough, with a phone pass of every main screen;
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
| Record revision requests | 🟡 | **Clients only.** You can't log a request that came by WhatsApp, a call or email |
| Identify out-of-scope requests | ✅ | Automatic, race-tested |
| Create change orders | ✅ | Fixed or hourly |
| Extra charges and timeline extensions | ✅ | |
| Client approval before extra work | ✅ | Recorded with evidence |
| Complete change history | ✅ | Activity log and the Approval record PDF |
| Project dashboard | ✅ | |
| Project status and milestones | ✅ | Plus deliverable progress |
| Deliverable deadlines | ❌ | Deadlines exist per project only |
| Activity timelines | ✅ | Filterable project timeline |
| Upcoming and overdue deadlines | ✅ | Dashboard Upcoming and Reminders (per project) |

## Phase 2 — Clients, quotations, invoices

| Item | Status | Evidence / notes |
|---|---|---|
| Create and edit client profiles | 🟡 | Editable on the client page, but **new clients can only be created inside a new project** |
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
| Revenue trends and charts | 🟡 | 12-month chart; **axis labels too small on phones** |
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
| Fully responsive mobile | 🟡 | No sideways scrolling on any main screen, but see the mobile issues below |
| Authentication and account recovery | ✅ | Email + password, reset by email (Brevo) |
| Google sign-in | ⛔ | Built; **waiting for your Google Client ID** |
| Database-level ownership and access controls | ✅ | RLS on all 24 tables, read-only to the app, writes only through checked functions; 5 public functions |
| Secure approval links / expiry / revocation | ✅ | |
| Input validation | ✅ | Both the app and the database |
| Error handling, loading and empty states | ✅ | |
| Automated tests / regression testing | ✅ | Every release re-runs all checks before deploying |
| No duplicate or inconsistent records | ✅ | Unique constraints, idempotency, race-tested |
| Database migrations tested | ✅ | Each re-runs safely and rolls back twice |
| Backup and rollback plan verified | 🟡 | Rollback is tested. **Backups are manual only**: Supabase Free has no downloadable automatic backups |
| Invite-only beta access verified | — | **Open by your decision (1 Nov)**. Invite-only mode still works and is tested |
| Privacy policy and terms reviewed | 🟡 | Terms are current. **The privacy policy doesn't yet mention invoice details (addresses, GSTIN), expenses or follow-ups** |
| Production deployment readiness | ✅ | Live, with smoke tests on every release |

## Bugs and risks

1. 🐞 **Dashboard "Upcoming" shows a part-paid payment's full amount**, not the balance. Small fix.
2. ⚠️ **No automatic database backups** on the free tier. This is the biggest risk now that real invoices and payments are stored.
3. ⚠️ **The privacy policy is behind the features** (invoice billing details, expenses, follow-ups).
4. ⚠️ **Scope-creep gap:** you can't log out-of-scope requests that arrive outside ScopeFlow (WhatsApp, calls), so they escape the revision count.
5. ℹ️ **Your email appears on invoices** sent to clients (normal for invoices; can be removed).
6. ℹ️ **Supabase Free:** 5 GB/month data transfer. Fine for now; check Usage weekly.

## Mobile UX issues

1. **Dashboard totals are cut off** with more than one currency ("₹313.00 · $…").
2. **Analytics chart labels are unreadably small** on a phone.
3. **Project page is very long on a phone.** Payments, the client link and the timeline sit far below the scope; jump links are needed.
4. **Main sections (Clients, Invoices, Analytics) hide behind the ⋯ menu** on phones; a bottom tab bar would help.

## Recommended order (S = hours, M = about a day, L = several days)

| Batch | What | Size | Needs approval? |
|---|---|---|---|
| A | Fix: Upcoming balance bug; dashboard currency totals; phone-readable chart; privacy policy update | S | No |
| B | **Core:** log a client request received outside ScopeFlow (WhatsApp/call/email), counted against revision limits with a "how it arrived" note; standalone "Add client" | M | No |
| C | **Core:** deliverable due dates (form, progress, reminders, client page) | M | Database change |
| D | Phone navigation: bottom tab bar and jump links on the project page | M | No |
| E | Automatic encrypted weekly backups through GitHub Actions (free) | M | **Yes**: needs a database connection secret, added by you |
| F | Quotes: "valid until", quantity × unit price lines, save your own templates | M | Database change |
| G | Analytics: per-project profit; quarter / financial-year / custom date filters; one notification centre | M | No |
| H | One-tap PDF download for quote, invoice and record (free library) | M | No |
| — | Phase 4 (recurring invoices, retainers, automation) | L | After real-freelancer validation |
