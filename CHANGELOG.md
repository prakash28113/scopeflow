# Changelog

## Terms & Conditions — ready for review (not released)

- Full **Terms & Conditions** at `/terms` (replaces the short beta "Terms of Use"). They cover:
  - operator Prakash Mummidisetti, users 18+;
  - client links, plans and fees, UPI payments made directly between you and your client;
  - acceptable use, content ownership, suspension and closing an account;
  - disclaimer, a liability cap (greater of 12 months' fees or ₹1,000) and indemnity;
  - Indian law with Hyderabad, Telangana courts;
  - a grievance officer under the IT Act, and 7 days' notice of important changes.
- Privacy Policy names the operator. Footer and sign-up page say "Terms & Conditions".

## Public launch — sign-ups open — live 1 Nov 2026 (release run 41310079526)

- `config/beta-allowlist.txt` is now `*`: anyone can create an account (Free plan by default; paid plans remain early access, nothing can be charged). Approved by the owner on 1 Nov 2026.
- Sign-up page: "Start free. No card needed."
- To go back to invite-only: replace `*` with a list of emails and run the release (existing accounts are kept).

## Password reset on — live 1 Nov 2026 (release run 41307038212)

- **"Forgot your password?" now emails a reset link**, sent by free Brevo SMTP (set up in Supabase; see `docs/EMAIL-SETUP.md`). `passwordResetEmail` is now `true`.
- **Privacy policy:** names Brevo, which receives only the email address and the reset link.
- **Terms:** say plainly that UPI payments go straight to the freelancer, and that ScopeFlow never receives or confirms them.
- **Walkthrough:** the browser walkthrough now tests the whole reset flow:
  - an unknown email gets the same answer as a real one;
  - the emailed link opens the reset page and the one-time code is removed from the address bar;
  - mismatched passwords are caught;
  - the new password signs you in, and the old one stops working.
- **Test stand-in:** the local auth stand-in keeps reset "emails" in memory so the walkthrough can open them. This is test-only and never part of the app.
- No database change.

## Launch prep — live 1 Nov 2026 (release run 41304518542)

- **Get paid by UPI.** Freelancers add their UPI ID in **Settings → Getting paid**. On rupee projects the client's page shows **Pay via UPI** on every unpaid milestone: it opens GPay, PhonePe, Paytm or BHIM with the amount filled in. There's also a QR code for desktop (made in the browser, no outside service) and **Copy UPI ID**. Money goes straight to the freelancer; ScopeFlow never handles payments and charges nothing. Non-rupee projects and accounts without a UPI ID see no button.
- **Share on WhatsApp or by email** from the "Client link ready" dialog, with the ready-made message and link (free `wa.me` / `mailto:` links; nothing is sent by ScopeFlow).
- **Link previews.** Links to scopeflow.in, including client links, now show a title, description and a 1200×630 preview card in WhatsApp, LinkedIn, X, Slack and iMessage. Also added `robots.txt` and `sitemap.xml`. Client links and reset pages stay out of search results through their `noindex` header (not through robots.txt, which would also hide the preview).
- **Password reset** (`/forgot-password`, `/reset-password`). Built and tested, but behind `passwordResetEmail` in `config/public-site.json`, which is **off** until free email (Brevo SMTP) is set up: see `docs/EMAIL-SETUP.md`. While it's off, "Forgot your password?" shows the support email, as before.
  - The same answer is given whether or not an account exists.
  - One-time codes are removed from the address bar immediately.
  - Reset pages are never cached or indexed.
  - The release now limits Supabase's redirect allow-list to `/reset-password` on ScopeFlow's own addresses.
- **Database:** `supabase/migrations/20261104000000_upi_payments.sql` is re-runnable and backward compatible: a new nullable `profiles.upi_id`, the same format check in the database and the app, `set_payment_details()` for signed-in users only, and `portal_view` returning payment details only for INR projects. Rollback is `supabase/rollback/20261104000000_upi_payments_down.sql` (tested twice in a row).
- **Tests:** 209 unit and database tests (new: UPI links and format, recovery-link parsing, redirect allow-list, private-page headers, preview tags and image size, the UPI database function). The 5 real-PostgreSQL race checks pass. The browser walkthrough now has **27 steps**, with 2 new ones:
  - the UPI ID is saved, the WhatsApp and email links are checked, and the client sees **Pay via UPI** with the exact amount plus a QR code;
  - the reset pages show the support fallback and the expired-link handling.

## v1.2 — Business tools — live 1 Nov 2026 (release run 41301669884)

- **Itemised quotes** in the project form: price each deliverable (fixed, or hours × rate), add an optional discount and tax (e.g. GST 18%). The database computes the total and sets the budget; the line items and totals are part of the locked scope the client approves (and its fingerprint).
- **Printable quote** (`/projects/:id/quote`) and **Save as PDF** on the client's scope page — browser printing, no paid PDF service.
- **Agreement templates**: graphic design, brand identity, website (starter, every plan), UI/UX, video editing, social media marketing (full library). They pre-fill deliverables, exclusions and terms; everything stays editable.
- **Clients**: list with projects and outstanding amounts; client page with projects, approval history, payments received, totals, phone and private notes (never shown to the client).
- **Database:** `supabase/migrations/20261103000000_v1_2_business_tools.sql` (re-runnable; backward compatible) · rollback `supabase/rollback/20261103000000_v1_2_business_tools_down.sql` (tested twice in a row).
- **Tests:** database tests (server-side totals, 40 random quotes cross-checked with the app's maths, locking, permissions, private notes), unit tests, and 3 new walkthrough steps.

## Subscription plans, Phase 1–2 — live 1 Nov 2026 (release run 41293215454)

- **Plans in the database** (`plans`): Free ($0; 2 active projects, 5 clients), Solo ($9/mo, $90/yr), Studio ($19/mo, $190/yr). Prices are hypotheses; none is purchasable yet.
- **Limits enforced by the database** inside `save_project` (error `SF402` with usage). Editing, approvals, change orders, payments and client links are never limited, on any plan or after a downgrade. Completed and cancelled projects don't count.
- **Subscriptions** (one per account, Free by default, backfilled for existing accounts) with statuses free / trial / active / past due / cancelled / expired; paid access needs a confirmed status, past due gets a 7-day grace, cancelled lasts to period end.
- **Nobody can change their own plan:** only `admin_set_plan()` (SQL editor; no API role) or, later, a signature-verified payment webhook through `process_billing_event()` (service role only; idempotent per provider event; a failed payment never grants access).
- **Audit and billing records:** append-only `subscription_changes`, `billing_events` (unique per provider event), `invoices` (owner-readable billing history), `early_access_requests`.
- **Pages:** public `/pricing` (monthly/yearly, recommended plan, comparison with "Coming" labels, FAQ), signed-in **Plan & usage** (`/plan`: plan, status, usage meters, early access, billing history), and a plan-limit card instead of a form when Free is full.
- **Database:** `supabase/migrations/20261102000000_subscription_plans.sql` (re-runnable) · rollback `supabase/rollback/20261102000000_subscription_plans_down.sql` (tested twice in a row).
- **Tests:** 17 new database tests, plan helper unit tests, a real-PostgreSQL race (6 simultaneous creations on Free → exactly 2), and 2 new walkthrough checks (pricing page; limit, plan page, early access).

## v1.1 — Clear agreements, visible revisions — live 1 Nov 2026 (release run 41292859363)

**For freelancers**
- **Agreement terms** on every project: *Not included* (one item per line), *price per extra revision round*, and *Terms* (payment, ownership, cancellation). They're part of the scope the client approves, stored in the locked scope version and covered by its fingerprint.
- **Scope check** while editing: plain rules (no AI, nothing leaves the browser) flag open-ended wording ("etc.", "unlimited", "as needed"…), too many revision rounds, missing exclusions, terms, due date, extra-round price or advance payment.
- **Revision tracker**: each deliverable shows used, remaining and extra rounds. An over-limit revision offers **Charge extra round · ₹X**, which opens a change order pre-filled with the agreed price.
- **Approval timeline** per scope version: Sent → Opened by client → Approved / Changes requested, with times. "Opened" also appears in notifications.
- **Upcoming** on the dashboard: project due dates and agreed payment dates that are overdue or due in the next 14 days.

**For clients**
- The scope page shows *Not included*, the extra-round price and the terms before the Approve button.
- Revision meters show what's left; when the included rounds are used, the request form states the extra-round price up front.

**Fixes**
- Removed two promises of emails the app doesn't send (client portal and project form).
- Retried or double-tapped change requests are recorded once (request id + unique included revision numbers).
- Payment and approval timestamps are shown in the viewer's time zone (were UTC, so off by a day near midnight in India).

**Release process** (production-readiness audit — [docs/release/v1.1/](docs/release/v1.1/README.md))
- Every push runs: unit + database tests, the unit suite in three time zones, a permission audit, real-PostgreSQL concurrency checks and the 22-step browser walkthrough.
- Deploy and rollback run only on a manual *Run workflow*; credentials only as least-privilege repository secrets (the chat hand-off was removed).

**Database** — `supabase/migrations/20261101000000_v1_1_agreement.sql` (additive, re-runnable, backward compatible)
- `projects.exclusions`, `projects.terms`, `projects.extra_revision_cents` (nullable, length/range checked; writable only through `save_project` while the scope is unlocked).
- `portal_view` records the first open of a scope version awaiting a decision as an immutable `scope.viewed` activity event (unique per version) and reports `revisions_extra` per deliverable.
- `revision_requests.client_request_id` and two unique indexes (retry-safe requests, unique included revision numbers); `portal_request_revision` gains an optional request id.
- No new tables, no new public functions; Row Level Security unchanged.
- Rollback: `supabase/rollback/20261101000000_v1_1_agreement_down.sql` (restores the v1.0 functions, drops the new columns and indexes; deletes data entered in them). Tested, including twice in a row.

**Release order** — the database must be migrated before the app is published. The release refuses an app-only deploy while a migration is pending (`config/public-supabase.json` → `databaseVersion`), so v1.1 needs one run with both the Supabase and Cloudflare tokens.

**Tests** — new database tests (agreement fields, fingerprint, locking, permissions, "viewed", extra rounds, rollback), unit tests (scope check, upcoming dates, labels, form conversion, release guard), and the end-to-end browser suite extended with v1.1 steps on Cloudflare's runtime (22 steps, no browser errors).

## v1.0 — Private beta (live 1 Nov 2026)
Scope, client approval links, locked scope versions, revision limits, change orders, manual payment milestones, in-app notifications, privacy/terms pages.
