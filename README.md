# ScopeFlow

Scope, client approvals, revisions, change orders and payment milestones for freelancers and small studios.

**Workflow:** create project → define scope → share client link → client approves (scope is snapshotted and locked) → client requests changes → system checks each request against the approved revision limits → freelancer proposes a priced change order → client approves → budget, due date and milestones update → milestones are marked paid.

Stack: Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Supabase (Postgres + Auth) · Resend · Vercel. Everything fits in free tiers.

---

## 1. Setup

### Supabase
1. Create a project at supabase.com (free tier).
2. **SQL Editor →** paste and run `supabase/migrations/20261031000000_scopeflow_schema.sql`.
   (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Authentication → URL Configuration:**
   - Site URL: your app URL (e.g. `https://scopeflow.vercel.app`)
   - Redirect URLs: add `https://YOUR-APP/auth/callback` and `http://localhost:3000/auth/callback`
4. **Authentication → Providers → Email:** keep "Confirm email" on for production.
   Supabase's built-in mailer is rate-limited (a few emails/hour). For real use, set custom SMTP
   (Resend provides SMTP credentials) under **Authentication → Emails → SMTP Settings**.

### Resend (optional but recommended)
1. Create an API key. 2. Verify your sending domain. 3. Set `RESEND_API_KEY` and `EMAIL_FROM`.
Without a key, ScopeFlow still works: notifications are logged as *skipped* and the project page shows the client link to share manually. Nothing claims an email was sent when it wasn't.

### Local
```bash
cp .env.example .env.local     # fill in values
npm install
npm run dev                    # http://localhost:3000
```

### Deploy to Vercel
Import the repo, add every variable from `.env.example` in **Project → Settings → Environment Variables** (set `NEXT_PUBLIC_APP_URL` to the production URL), deploy. Update the Supabase Site URL / redirect URLs to match.

## 2. Environment variables

| Variable | Required | Where it's used |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser + server; all user & portal queries (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only: freelancer email lookup for notifications, email log writes |
| `NEXT_PUBLIC_APP_URL` | yes | Client links, auth redirects, email links |
| `SHARE_TOKEN_SECRET` | yes | AES-256-GCM key for stored client links (`openssl rand -base64 32`) |
| `RESEND_API_KEY` | no | Sending email; absent → logged as skipped |
| `EMAIL_FROM` | no | Sender address on your verified domain |

## 3. Architecture

```
app/
  (auth)/          login, signup, password reset, server actions
  auth/callback    email confirmation / recovery
  onboarding/      workspace setup + settings
  (app)/           authenticated area: dashboard, projects, change orders
  p/[token]/       client portal — no account, token-gated
lib/               validation (zod), money/pricing maths, tokens, email, Supabase clients
supabase/migrations/  the entire schema, RLS, and business logic
proxy.ts           session refresh + redirect for signed-out users (Next 16 "proxy")
tests/             unit, database (real Postgres via PGlite), end-to-end
```

**Writes happen only through Postgres functions.** Authenticated users can `SELECT` their own rows (RLS) but have no direct `INSERT/UPDATE/DELETE`. Every mutation is a `SECURITY DEFINER` function that checks `auth.uid()`, locks the project row, and enforces the state machine:

`draft → awaiting_approval → (changes_requested → awaiting_approval)* → active → completed` (or `cancelled`)

Data model: `profiles · clients · projects · deliverables · milestones · scope_snapshots · scope_decisions · share_links · revision_requests · change_orders · change_order_decisions · activity_log · email_log`.

## 4. Security

- **RLS on every table.** `anon` can read nothing. Tests prove a user can't read or act on another user's data.
- **Client tokens:** 256-bit random, URL-safe. The database stores only the SHA-256 hash (for lookup) and an AES-GCM ciphertext (so you can re-copy the link). A database leak alone doesn't reveal working links. Links can be rotated or revoked; old ones stop working immediately.
- **Portal access** goes only through `portal_*` functions that require the token and return just what a client should see.
- **Immutable records:** scope snapshots, scope decisions, change-order decisions and the activity log reject every `UPDATE` (even from the service role) via triggers. Change-order terms and revision scope classifications can't change after creation.
- **Snapshots are fingerprinted** (SHA-256 of the exact content). Each approval records the fingerprint, client name, time, user agent and IP.
- **Server-side authorization** in every server action (`supabase.auth.getUser()`, not session cookies alone), plus the database checks.
- **Validation twice:** zod on the server, and constraints/checks in Postgres.
- Money is stored as integer minor units and parsed from strings — no floating-point amounts. The database computes change-order prices; the UI preview uses the same rounding (tested against Postgres).
- Portal pages send `Referrer-Policy: no-referrer`, `noindex`, `no-store`. Open-redirect-safe `next` parameters; HTML-escaped emails; database error details are never shown to users.

## 5. Tests

```bash
npm test          # 52 unit + database tests
npm run typecheck
npm run build
```

- `tests/db/` runs the **real migration** on in-process Postgres (PGlite) with Supabase-equivalent roles and `auth.uid()`: the full workflow, scope checks, pricing, immutability, RLS isolation, privilege checks, token rotation/revocation.
- `tests/unit/` covers money parsing, pricing (cross-checked against Postgres rounding), token crypto, validation, email escaping, redirects.
- `tests/e2e/` drives the built app in Chrome through the complete workflow as both freelancer (desktop) and client (phone), plus revoked-link, cross-account and signed-out checks. It runs against a local Supabase stand-in (PGlite + the real PostgREST binary + a small auth shim):
  ```bash
  # needs the PostgREST v12 binary: https://github.com/PostgREST/postgrest/releases
  cd tests/e2e && npm i @electric-sql/pglite @electric-sql/pglite-socket playwright
  POSTGREST_BIN=/path/to/postgrest node stack.mjs &          # writes keys.json
  # build & start the app with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321,
  # the anon/service keys from keys.json, NEXT_PUBLIC_APP_URL=http://localhost:3000
  node workflow.mjs
  ```

## 6. What's not in this MVP (deliberately)

- **File uploads / proofs** (Supabase Storage) — the natural next module: attach proofs to deliverables so clients approve the actual files.
- **Payment processing.** Milestones are tracked; payments are recorded manually. No fake "Pay now" button.
- **Rate limiting** on the client portal. Tokens are unguessable, but add Vercel/Upstash rate limiting before heavy public use.
- **Account deletion UI** (the schema cascades correctly; there's no button yet).
- Team members / multiple seats, invoices, PDF export.

Supabase free projects pause after a week without activity — upgrade or keep it active for production use.
