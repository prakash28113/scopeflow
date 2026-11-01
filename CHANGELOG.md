# Changelog

## v1.1 — Clear agreements, visible revisions (not yet deployed)

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

**Database** — `supabase/migrations/20261101000000_v1_1_agreement.sql` (additive; existing projects unaffected)
- `projects.exclusions`, `projects.terms`, `projects.extra_revision_cents` (nullable, length/range checked; writable only through `save_project` while the scope is unlocked).
- `portal_view` records the first open of a scope version awaiting a decision as an immutable `scope.viewed` activity event (unique per version) and reports `revisions_extra` per deliverable.
- No new tables, no new public functions; Row Level Security unchanged.
- Rollback: `supabase/rollback/20261101000000_v1_1_agreement_down.sql` (restores the v1.0 functions, drops the three columns and the index; deletes data entered in them). Tested.

**Release order** — the database must be migrated before the app is published. The release refuses an app-only deploy while a migration is pending (`config/public-supabase.json` → `databaseVersion`), so v1.1 needs one run with both the Supabase and Cloudflare tokens.

**Tests** — new database tests (agreement fields, fingerprint, locking, permissions, "viewed", extra rounds, rollback), unit tests (scope check, upcoming dates, labels, form conversion, release guard), and the end-to-end browser suite extended with v1.1 steps on Cloudflare's runtime (23 steps, no browser errors).

## v1.0 — Private beta (live 1 Nov 2026)
Scope, client approval links, locked scope versions, revision limits, change orders, manual payment milestones, in-app notifications, privacy/terms pages.
