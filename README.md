# ScopeFlow

Scope, client approvals, revisions, change orders and payment milestones for freelancers and small studios.
Built to run at **₹0**: a static React app on Cloudflare Workers Free + Supabase Free. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how authentication, database access, client links and the Worker work.

**Workflow:** create project → define scope → send to client (private link) → client approves (scope is
snapshotted and locked) → client requests changes → each request is checked against the approved revision
limits → freelancer proposes a priced change order → client approves → budget, due date and milestones
update → milestones are marked paid (recorded manually).

Stack: Vite · React 19 · React Router 7 · TanStack Query · Tailwind CSS 4 · Supabase (Postgres + Auth) ·
Cloudflare Workers (static assets + a tiny cron Worker). No email provider, no paid services.
Security review and verification: [FINAL_AUDIT.md](FINAL_AUDIT.md). What changed in each version: [CHANGELOG.md](CHANGELOG.md).
**Deploying the private beta:** the GitHub Actions workflow deploys everything automatically once two
secrets are added — see *Automatic deployment* in **[DEPLOYMENT.md](DEPLOYMENT.md)** (Supabase setup, migration, allowlist,
Cloudflare commands, verification, backups, rollback and a step-by-step checklist).

---

## 1. Supabase (free project)

1. Create a project at supabase.com.
2. **SQL Editor →** run each file in `supabase/migrations/` in name order (the release automation does this for you).
3. **Authentication → Sign In / Providers → Email:**
   - turn **Confirm email OFF** (the beta sends no email),
   - set **Minimum password length** to 8 (or more).
4. *(Optional, recommended)* **Private beta allowlist** — while this table has rows, only these emails can sign up:
   ```sql
   insert into public.beta_allowlist (email) values ('you@example.com'), ('friend@studio.com');
   ```
   Empty the table to open sign-ups.
5. *(Optional)* **CAPTCHA:** create a free Cloudflare Turnstile widget, then Supabase → Authentication →
   Bot and Abuse Protection → enable CAPTCHA (Turnstile) with the secret key, and set
   `VITE_TURNSTILE_SITE_KEY` when building.

**Resetting a forgotten password** (there's no reset email during the beta) — in the SQL Editor:
```sql
update auth.users
   set encrypted_password = extensions.crypt('a-new-temporary-password', extensions.gen_salt('bf'))
 where email = 'user@example.com';
```
Tell the user the temporary password; they can change it in **Settings**.

## 2. Local development

```bash
cp .env.example .env.local      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev                     # http://localhost:5173
```

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Public. Also pins the Content-Security-Policy to this origin |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable key (`sb_publishable_…`), public by design. The legacy anon key also works via `VITE_SUPABASE_ANON_KEY` |
| `VITE_TURNSTILE_SITE_KEY` | no | Enables the CAPTCHA widget and allows Turnstile in the CSP |

There are no server secrets. Never put the Supabase **service-role** key in this project.

## 3. Deploy to Cloudflare (free) — only when you approve

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for exact steps. In short: fill `.env.production.local` and the
`vars` in `wrangler.jsonc` with your Project URL and publishable key, `npx wrangler login`, then
`npm run deploy` (which refuses to deploy placeholder or mismatched settings).

What runs where on the free plan:
- Pages and files: Workers **static assets** — free, unlimited, no Worker CPU.
- Worker script: a twice-daily cron that calls `public.health()` so Supabase doesn't pause the project,
  plus a JSON 404 for stray API calls (~2 invocations/day of the 100,000/day allowance).

## 4. Tests

```bash
npm run verify         # all of the below except e2e
npm test               # 131 unit + database tests (real migration on in-process Postgres)
npm run typecheck
npm run audit:secrets  # build with a public test config, scan build output + repo for secrets
npm run audit:deps     # licences, paid-service SDKs, external hosts in the bundle
npm run build          # needs VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
npm run deploy         # build → pre-deploy check → wrangler deploy (only with your approval)
```

- `tests/db/` — the whole workflow, scope checks, pricing, immutability, RLS isolation, privilege checks,
  token hashing/expiry/rotation/revocation, portal abuse limits (per IP, per link, failed-lookup
  lockout, spoofed-header resistance), minimal public responses, beta allowlist, notifications.
  `permissions.test.ts` audits every table, policy and function grant from the database catalog.
- `tests/unit/` — money parsing, pricing (cross-checked against Postgres rounding), validation,
  client-link parsing, redirects, error filtering, the Worker, the CSP builder (with and without
  Turnstile), the portal error wrapper and the secret scanner.
- `tests/db/rollback.test.ts` — the teardown script removes everything and the migration reinstalls;
  the post-restore trigger script works.
- `tests/e2e/` — the built app in **Cloudflare's runtime** (`wrangler dev`) with Chrome, as freelancer
  (desktop) and client (phone), plus link replacement/revocation, malformed links, cross-account and
  signed-out checks, a no-horizontal-scroll check on mobile, and a browser-level rate-limit lockout. Uses a local Supabase stand-in
  (PGlite + the real PostgREST binary + a small auth shim):
  ```bash
  (cd tests/e2e && npm install)
  # PostgREST v12 binary: https://github.com/PostgREST/postgrest/releases
  POSTGREST_BIN=/path/to/postgrest CHROME_PATH=/path/to/chrome tests/e2e/run.sh
  ```

## 5. Public portal limits

All public client-portal calls are rate-limited in the database (details in ARCHITECTURE.md §4):
300 calls per IP per 10 min; 20 failed link lookups per IP per hour (then blocked for the hour);
per link 300 reads per 10 min and 30 writes per hour; 10 change requests per project per hour.
Clients who hit a limit see "Too many requests — please wait a few minutes".

## 6. Deliberately not in this MVP

- Email of any kind (sign-up confirmation, password reset, notifications). Notifications are in-app.
- File uploads / proofs.
- Payment processing — payments are recorded manually.
- Automatic backups (Supabase Free has none) — export from the dashboard periodically.
- Custom domain (costs money); the free `*.workers.dev` address is used.
