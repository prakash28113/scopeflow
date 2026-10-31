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

---

## 1. Supabase (free project)

1. Create a project at supabase.com.
2. **SQL Editor →** run `supabase/migrations/20261031000000_scopeflow_schema.sql`.
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
| `VITE_SUPABASE_ANON_KEY` | yes | Public by design; access is enforced by RLS and database functions |
| `VITE_TURNSTILE_SITE_KEY` | no | Enables the CAPTCHA widget and allows Turnstile in the CSP |

There are no server secrets. Never put the Supabase **service-role** key in this project.

## 3. Deploy to Cloudflare (free) — only when you approve

1. In `wrangler.jsonc`, set `vars.SUPABASE_URL` and `vars.SUPABASE_ANON_KEY` (used only by the daily keep-alive).
2. `npx wrangler login` (free Cloudflare account; no card needed).
3. `VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm run deploy`
4. The app is served at `https://scopeflow.<your-subdomain>.workers.dev`. Add that URL to
   Supabase → Authentication → URL Configuration (Site URL).

What runs where on the free plan:
- Pages and files: Workers **static assets** — free, unlimited, no Worker CPU.
- Worker script: a daily cron that calls `public.health()` so Supabase doesn't pause the project after
  7 idle days, plus a JSON 404 for stray API calls. ~1 invocation/day of the 100,000/day allowance.

## 4. Tests

```bash
npm test            # unit + database tests (real migration on in-process Postgres)
npm run typecheck
npm run build
```

- `tests/db/` — the whole workflow, scope checks, pricing, immutability, RLS isolation, privilege checks,
  token hashing/expiry/rotation/revocation, rate limiting, beta allowlist, notifications.
- `tests/unit/` — money parsing, pricing (cross-checked against Postgres rounding), validation,
  client-link parsing, redirects, error filtering, the Worker.
- `tests/e2e/` — the built app in **Cloudflare's runtime** (`wrangler dev`) with Chrome, as freelancer
  (desktop) and client (phone), plus link replacement/revocation, malformed links, cross-account and
  signed-out checks, and a no-horizontal-scroll check on mobile. Uses a local Supabase stand-in
  (PGlite + the real PostgREST binary + a small auth shim):
  ```bash
  (cd tests/e2e && npm install)
  # PostgREST v12 binary: https://github.com/PostgREST/postgrest/releases
  POSTGREST_BIN=/path/to/postgrest CHROME_PATH=/path/to/chrome tests/e2e/run.sh
  ```

## 5. Deliberately not in this MVP

- Email of any kind (sign-up confirmation, password reset, notifications). Notifications are in-app.
- File uploads / proofs.
- Payment processing — payments are recorded manually.
- Automatic backups (Supabase Free has none) — export from the dashboard periodically.
- Custom domain (costs money); the free `*.workers.dev` address is used.
