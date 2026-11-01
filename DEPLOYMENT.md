# ScopeFlow — Private Beta Deployment Guide

**Status: ready to deploy, NOT deployed.** Nothing in this guide has been run against your accounts.
Every step below is ₹0. If any screen asks for a payment method, **stop** — none is needed.

Related: [README.md](README.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [FINAL_AUDIT.md](FINAL_AUDIT.md)

---

## ⚡ Automatic deployment (recommended — works from a phone)

GitHub Actions (`.github/workflows/release.yml`) runs every check on each push, and deploys **only when
the owner taps *Run workflow*** (Actions → Release → action `release`). Credentials live only in
repository secrets with least privilege — never in chat or in the repository. Rollback is the same
button with action `rollback-app` or `rollback-database`.

Current release documents: **[docs/release/v1.1/](docs/release/v1.1/README.md)** — deployment plan
(secrets, steps, checks), rollback plan, test report, migration diff and permission audit.

## 0. What you need (all free)

| Item | Used for | Cost |
|---|---|---|
| Supabase account, Free plan | Database + sign-in | ₹0, no card |
| Cloudflare account, Workers Free | Hosting at `scopeflow.<you>.workers.dev` | ₹0, no card |
| Node.js 20 or newer | Build + deploy commands | Free |
| Docker Desktop + `psql` (Postgres 17 client) | Backups only (§7) | Free (Docker is free for personal and small-business use) |

On your computer, in the unzipped `scopeflow` folder:

```bash
npm ci          # installs exact, audited versions
npm run verify  # typecheck + 106 unit/database tests + secret scan + dependency audit — must pass
```

---

## 1. Create the Supabase project

1. Sign in at supabase.com → **New organization** → plan **Free**.
2. **New project**:
   - **Name:** `scopeflow-beta`
   - **Database password:** generate a strong one and save it in your password manager. It's needed only for backups; the app never uses it.
   - **Region:** the one closest to you and most clients (for example *Mumbai*).
3. Wait until the project shows **Healthy**.
4. **Project Settings → API Keys** — copy:
   - **Project URL**, like `https://abcdefghijklmnop.supabase.co`
   - **Publishable key** (`sb_publishable_…`). If your project only shows legacy keys, use the **anon** key instead.
   - **Never copy the secret / service_role key anywhere.** ScopeFlow doesn't use it.

## 2. Run the database migration

Use **one** of the two options.

**Option A — SQL Editor (simplest)**
1. Supabase → **SQL Editor** → **New query**.
2. Open `supabase/migrations/20261031000000_scopeflow_schema.sql`, copy the **entire** file, paste it, and click **Run**.
3. Expect "Success. No rows returned".
4. If it errors partway: run `supabase/rollback/teardown.sql` (it cleans up whatever was created), then run the migration again. That teardown-and-reinstall path is covered by an automated test.

**Option B — Supabase CLI**
```bash
npx supabase login
npx supabase init                      # creates supabase/config.toml; keep the existing migrations folder
npx supabase link --project-ref abcdefghijklmnop
npx supabase db push                   # applies supabase/migrations/*.sql and records them
```

**Verify the migration** (SQL Editor). Each query has an expected result:
```sql
-- Expect 14
select count(*) from pg_tables where schemaname = 'public';

-- Expect 0 rows (every table has Row Level Security)
select relname from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;

-- Expect exactly 5 rows:
-- health, portal_decide_change_order, portal_decide_scope, portal_request_revision, portal_view
select proname from pg_proc
 where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'EXECUTE')
 order by 1;

-- Expect 1 row
select tgname from pg_trigger
 where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
```

## 3. Configure authentication

Supabase → **Authentication**:

1. **Sign In / Providers → Email:**
   - **Enable email provider:** on
   - **Confirm email:** **OFF** — the beta sends no email
   - **Minimum password length:** **8**. If it isn't on this screen in your dashboard version, look for "password" in the Authentication settings.
2. **URL Configuration → Site URL:** set it after the first deploy (§5, step 6).
3. **Rate limits:** leave the defaults.
4. *(Optional)* **CAPTCHA (free Cloudflare Turnstile):**
   - Cloudflare dashboard → **Turnstile** → add a widget for your `workers.dev` hostname → copy the **site key** and **secret key**.
   - Supabase → **Authentication → Attack Protection** (labelled "Bot and Abuse Protection" in some versions) → enable CAPTCHA → provider **Turnstile** → paste the **secret key**.
   - Put the **site key** in `VITE_TURNSTILE_SITE_KEY` (§5). The build then adds Turnstile to the security policy automatically.

## 4. Beta allowlist (who can sign up)

While `beta_allowlist` has **any** rows, only those emails can create accounts. The database enforces this, so the public API can't get around it. Emails are stored in lowercase.

```sql
-- Invite people (run in SQL Editor)
insert into public.beta_allowlist (email, note) values
  ('you@example.com', 'founder'),
  ('designer.friend@example.com', 'beta wave 1');

-- See the list
select email, note, created_at from public.beta_allowlist order by created_at;

-- Remove an invite (doesn't delete an existing account)
delete from public.beta_allowlist where email = 'designer.friend@example.com';

-- Open sign-ups to everyone (empty the list)
-- delete from public.beta_allowlist;
```

- **Add yourself first**, before deploying.
- Someone not on the list sees: *"ScopeFlow is in private beta and this email isn't on the invite list."*
- **To remove a user's access:** Authentication → Users → the user → **Delete user**. Their projects are deleted with them.
- **Forgotten password** (there's no reset email):
  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('Temporary-Password-123', extensions.gen_salt('bf'))
   where email = 'user@example.com';
  ```
  Give them the temporary password over a private channel. They change it in **Settings**, which asks for the current password.

## 5. Deploy to Cloudflare (only after you approve)

1. **Build settings.** Create `.env.production.local` in the project root. It's git-ignored and holds public values only:
   ```bash
   VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxx
   # VITE_TURNSTILE_SITE_KEY=0x4AAAAAAA...   (only if you set up CAPTCHA)
   ```
2. **Worker settings.** In `wrangler.jsonc`, replace the two placeholders under `vars`:
   - `SUPABASE_URL` → the same Project URL
   - `SUPABASE_ANON_KEY` → the same publishable key
3. **Sign in to Cloudflare:**
   ```bash
   npx wrangler login           # opens the browser; approve access
   npx wrangler whoami          # confirms the account
   ```
4. **Deploy:**
   ```bash
   npm run deploy
   ```
   This runs, in order:
   - `vite build`, which creates `dist/` and the security-headers file
   - the pre-deploy check, which **refuses to deploy** if the `wrangler.jsonc` values are placeholders, don't match the build, or the build points at a local or test database
   - `wrangler deploy`

   On a brand-new Cloudflare account, wrangler may ask you to choose a `workers.dev` subdomain. Pick any name; it's free.
5. The command prints the URL: `https://scopeflow.<your-subdomain>.workers.dev`.
6. Supabase → **Authentication → URL Configuration → Site URL** → paste that URL → Save.
7. **Confirm the keep-alive schedule:**
   - Cloudflare dashboard → Workers & Pages → `scopeflow` → Settings → **Triggers** should show the cron `17 3,15 * * *`. `wrangler deploy` applies it automatically.
   - The Worker pings Supabase at 03:17 and 15:17 UTC daily, so the free project isn't paused.
   - `npx wrangler deployments list` shows the deployment.

## 6. Post-deploy verification (≈ 15 minutes)

Use a normal browser window for the freelancer, and your phone (or a private window) for the client.

**Authentication**
- [ ] Sign up with an allowlisted email: you land on onboarding immediately, with no email step.
- [ ] Sign up with a non-allowlisted email: you get the private-beta message.
- [ ] Sign out, then a wrong password ("Incorrect email or password."), then the right password.
- [ ] Settings → change password: requires the current password.

**Client approval links**
- [ ] Create a project, then **Send to client**. The link dialog appears once; copy it.
- [ ] On the phone, open the link → request changes. On the computer, the bell shows 1 → edit → **Send revised scope**.
- [ ] On the phone: approve, then request 3 revisions on one deliverable. The third is flagged "Beyond scope".
- [ ] Propose a change order, approve it on the phone, then **Mark paid** on the computer.
- [ ] **Replace link.** The old link shows "This link isn't working" and the new one works. **Revoke** → the link stops working.

**Rate limits and security headers** (SQL Editor and a terminal):
```sql
-- IP-based limits are active if both return a value / > 0
select ip_address from public.scope_decisions order by created_at desc limit 1;   -- not null
select count(*) from public.portal_rate_limits where bucket like 'ip:%';          -- > 0
```
```bash
curl -sI https://scopeflow.<sub>.workers.dev/ | grep -iE "content-security-policy|x-frame-options|referrer-policy"
curl -sI https://scopeflow.<sub>.workers.dev/p | grep -iE "x-robots-tag|cache-control"
```
- [ ] **If both SQL checks return null / 0:** Supabase isn't passing the client IP. Per-link limits still work; note it and tell me.
- [ ] **CAPTCHA (if enabled):** the widget shows on sign-in and sign-up, and the browser console has no CSP errors.

## 7. Backups (Supabase Free has no automatic backups you can download)

**When:** before every database change, and weekly during the beta.

**Prerequisites:** Supabase CLI (`npx supabase`), Docker Desktop running, and `psql` (Postgres 17 client).

**Connection string:** Supabase → **Connect** → **Session pooler** (works on IPv4) → copy it, then insert your database password. Percent-encode any special characters in the password.

**Back up** (Supabase's documented method):
```bash
# Paste the Session pooler string from Supabase → Connect, with your database password filled in.
# Type it into your terminal only — never save it in a file inside the project.
export DB_URL='<session-pooler-connection-string>'
mkdir -p backups/$(date +%F) && cd backups/$(date +%F)
npx supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
npx supabase db dump --db-url "$DB_URL" -f schema.sql
npx supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

- **Keep backups private.** They contain client names and emails and your users' password hashes.
- Store them encrypted, for example on an encrypted disk or in a password-protected archive, and never in the repository. `backups/` is git-ignored.

**Test a restore once before inviting users.** The Free plan allows 2 active projects, so use the second slot:
1. Create project `scopeflow-restore-test` → copy its Session pooler URL as `NEW_DB_URL`.
2. Restore:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "$NEW_DB_URL"
   ```
3. **Then run `supabase/rollback/restore-auth-trigger.sql`** in the new project's SQL Editor. Supabase's dump doesn't include custom triggers on the `auth` schema, and without this trigger new sign-ups get no profile and skip the allowlist. A test covers this script.
4. Re-apply the Auth settings from §3 in the new project; they aren't part of the dump.
5. Check the row counts:
   ```sql
   select (select count(*) from public.projects) projects, (select count(*) from auth.users) users;
   ```
6. Delete the test project afterwards to free the slot.

If `psql` reports permission errors on `ALTER … OWNER TO "supabase_admin"` lines in `schema.sql`, comment those lines out and re-run. Supabase documents this.

## 8. Rollback procedures

**A. Bad app release** (database unchanged). This is instant and costs nothing:
```bash
npx wrangler versions list                 # find the previous good version id
npx wrangler rollback <version-id> --message "roll back to previous release"
```
Cloudflare keeps the last 100 versions. Reload the site to confirm. To redeploy a fixed build later, run `npm run deploy`.

**B. Bad database change** (future migrations). ScopeFlow migrations are forward-only, and approval records are immutable by design.
1. **Preferred — fix forward:** write a new migration that corrects the problem, back up (§7), and apply it.
2. **Restore — if data was damaged:**
   1. Restore the latest backup into a new project (§7, steps 1–5).
   2. Rebuild with the new URL and key: update `.env.production.local` and `wrangler.jsonc`, then `npm run deploy`.
   3. Client links keep working, because their hashes are in the data.
   4. Freelancers sign in again: the new project has new signing keys, so old sessions end.
3. Then pause or delete the damaged project.

**C. Abort the beta entirely:**
1. Back up (§7).
2. Run `supabase/rollback/teardown.sql` in the SQL Editor. It removes all ScopeFlow tables, functions and data in one transaction; accounts in `auth.users` stay until you delete them.
3. In Cloudflare: Workers & Pages → `scopeflow` → Settings → **Delete**, or run `npx wrangler delete`.

**D. A single leaked client link:** on the project page, **Replace link** or **Revoke**. It takes effect immediately; no deploy needed.

## 9. Costs and billing — confirmation

**Everything in this deployment is free:**
- Supabase Free
- Cloudflare Workers Free (static assets plus a twice-daily cron)
- Optional Turnstile
- All npm packages: 116 installed, all open source; the 8 shipped to browsers are MIT, plus the Inter font under OFL. Run `npm run audit:deps`.

**Neither free plan asks for a payment method.** If one does, stop.

**Free plans stop rather than charge:**
- Cloudflare Workers Free rejects requests beyond 100,000 a day. Static pages don't count towards that; ScopeFlow uses about 2 Worker requests a day.
- Supabase Free restricts the project when a quota is exceeded.
- Neither adds charges unless you upgrade.

**Things that would cost money — not used, and not needed for the beta:**
- a custom domain
- Supabase Pro (daily backups, no pausing)
- Workers Paid
- any email-sending service

Cloudflare describes `workers.dev` addresses as best for personal or hobby projects. That's fine for a private beta; a custom domain is the step up for a public launch.

**Supabase pausing:** free projects pause after low activity over about 7 days, and you get a warning email first. The keep-alive prevents this. If a project does pause, **Resume project** in the dashboard restores it with its data, within 1 year.

---

## 10. Step-by-step checklist

**Before (on your computer)**
- [ ] 1. Unzip, then `npm ci` and `npm run verify`: all checks pass.

**Supabase**
- [ ] 2. Create a Free organization and the `scopeflow-beta` project (§1). Save the DB password.
- [ ] 3. Copy the Project URL and **publishable** key. Never the secret key.
- [ ] 4. Run the migration (§2) and the 4 verification queries.
- [ ] 5. Auth: Confirm email **off**, minimum password length **8** (§3).
- [ ] 6. *(Optional)* Turnstile: site key and secret key set up (§3.4).
- [ ] 7. Add yourself and the first beta users to `beta_allowlist` (§4).
- [ ] 8. Take a first backup and **test a restore** in a second free project (§7). Delete the test project.

**Cloudflare — ⛔ requires your approval before this point**
- [ ] 9. Fill in `.env.production.local` and the `wrangler.jsonc` vars (§5.1–2).
- [ ] 10. `npx wrangler login`, then `npm run deploy`. The pre-deploy check must pass.
- [ ] 11. Set the Supabase Site URL to the `workers.dev` URL.

**After**
- [ ] 12. Post-deploy verification: authentication, links, rate limits, headers (§6).
- [ ] 13. Confirm the IP-limit queries return values (§6); if not, report back.
- [ ] 14. Invite beta users: send the URL and tell them to sign up with their allowlisted email.
- [ ] 15. Weekly: back up (§7), and check Supabase usage under Organization → Usage.
