# ScopeFlow — Final Security Audit

Date: 1 November 2026 · Scope: repository at this commit · Status: **not deployed**; no paid services used.

This report covers the three external audit findings, a full review of database access control and
`SECURITY DEFINER` functions, a secret scan of the build output, and the results of every test suite.
Most checks are enforced by automated tests, so they keep holding as the code changes.

---

## 1. Findings and resolutions

### Finding 1 — CSP for Cloudflare Turnstile — **Resolved**

**Issue:** with CAPTCHA enabled, the policy allowed Turnstile in `script-src` and `frame-src` only.

**Change:** the CSP is now built by `build/security-headers.ts`. When `VITE_TURNSTILE_SITE_KEY` is set,
the exact origin `https://challenges.cloudflare.com` is added to `script-src`, `frame-src` **and
`connect-src`**. Nothing else is broadened.

| Directive | CAPTCHA off | CAPTCHA on |
|---|---|---|
| `script-src` | `'self'` | `'self' https://challenges.cloudflare.com` |
| `connect-src` | `'self' <supabase-origin>` | `'self' <supabase-origin> https://challenges.cloudflare.com` |
| `frame-src` | `'none'` | `https://challenges.cloudflare.com` |
| everything else | unchanged | unchanged |

- **Rationale:** Cloudflare's CSP reference lists `script-src` and `frame-src` as required, and
  `connect-src 'self'` for pre-clearance mode (`'self'` is always present). The exact Turnstile origin
  in `connect-src` ensures requests the widget script makes from the page are never blocked. No
  wildcard is used.
- **Also tightened:**
  - one `Referrer-Policy: no-referrer` for the whole site (previously two values on `/p`)
  - `manifest-src 'self'`
  - `Permissions-Policy` now also denies USB
- **Verified by:**
  - `tests/unit/security-headers.test.ts` (5 tests): CAPTCHA off / on, no inline or eval scripts, no wildcards, framing denied, a single Referrer-Policy, malformed Supabase URL rejected
  - the generated `_headers` of a CAPTCHA-enabled build was inspected
- **Not verified live:** the widget itself could not be loaded from the test environment, which has no access to `challenges.cloudflare.com`. See the deploy checklist (§6).

### Finding 2 — Rate limit covered only revision requests — **Resolved**

**Clarification:** the earlier 10-per-hour limit applied only to `portal_request_revision`, per project.
Portal reads and decisions were unlimited.

**Change:** every public `portal_*` function, reads included, now runs `_portal_gate` first. The gate
validates the link and applies fixed-window limits:

| Limit | Applies to | Value |
|---|---|---|
| Per client IP | every portal call | 300 / 10 min |
| Failed link lookups per client IP | invalid or revoked tokens | 20 / hour, then the IP is blocked for the rest of the hour |
| Per link — reads | `portal_view` | 300 / 10 min |
| Per link — writes | scope decisions, change-order decisions, change requests | 30 / hour |
| Per project — change requests | `portal_request_revision` | 10 / hour (unchanged) |

Design points, each covered by a test:
- **Counters persist on failure.** A Postgres error rolls back the whole call, so a failing lookup could never be counted. The gate therefore *returns* `{ error, message }` for link and rate problems, and the counters commit. The app maps these to normal error messages (`src/lib/portal-rpc.ts`).
- **No spoofed IPs.** IP limits use only gateway-set headers (`cf-connecting-ip`, `x-real-ip`), never the client-controllable `X-Forwarded-For`. That prevents bypassing the limits and prevents getting someone else's IP locked out. Without those headers, IP limits are skipped and the per-link limits still apply.
- **Privacy.** IP buckets store a truncated SHA-256 of the IP. Counters are in a private table (no API access), purged after a day by the daily `health()` call and opportunistically on writes.

**Verified by** `tests/db/workflow.test.ts` → *public portal abuse limits* (6 tests):
- failed lookups are counted and lock out the IP, while other IPs are unaffected
- `X-Forwarded-For` is ignored for limits
- the per-IP cap
- the per-link read cap (301st read rejected)
- the per-link write cap (with reads still allowed)
- hashed IPs only, counters private, old windows purged

### Finding 3 — `owner_id` in public decision responses — **Resolved**

**Change:**

| Function | Now returns |
|---|---|
| `portal_decide_scope` | `{ ok, decision, version }` |
| `portal_request_revision` | `{ ok, in_scope, revision_number, revisions_included }` |
| `portal_decide_change_order` | `{ ok, decision, number }` |

- `owner_id`, `project_id`, internal row ids, names and comments were removed from these responses.
- `portal_view` also no longer returns the client email stored inside the scope snapshot; the page never displays it.

**Verified by:**
- `tests/db/workflow.test.ts` → *public responses expose no internal identifiers*: exact key sets, and no owner id, project id or email anywhere in portal output
- `tests/db/permissions.test.ts`: no portal function source returns `owner_id`, `project_id` or `email`

---

## 2. Access-control review (RLS and SECURITY DEFINER)

The review is automated in `tests/db/permissions.test.ts` (15 tests). It reads PostgreSQL's catalog
after applying the real migration, with Supabase's default broad grants in place, and compares
everything against an explicit allowlist. Adding a table or function without reviewing its access
makes the suite fail.

| Check | Result |
|---|---|
| Tables in `public` | 14, exactly the reviewed set; **RLS enabled on all** |
| Views, materialized views, sequences in `public` | none (views could bypass RLS) |
| `anon` table privileges | **none** on any table (all 7 privilege types checked) |
| `authenticated` table privileges | `SELECT` only, on 11 owner-scoped tables; **no INSERT/UPDATE/DELETE/TRUNCATE anywhere** |
| `share_links` | owners can read status columns; **`token_hash` not readable** |
| `beta_allowlist`, `portal_rate_limits` | no API access at all |
| Policies | 12, all `SELECT`, all `TO authenticated`, all permissive, all using `auth.uid()` |
| Immutability triggers | on `scope_snapshots`, `scope_decisions`, `change_order_decisions`, `activity_log` |
| `SECURITY DEFINER` functions | exactly 22: 16 freelancer API, 4 portal, `health`, the sign-up trigger |
| `search_path` | pinned to empty on **every** function in `public` (no search-path hijacking) |
| `anon` can EXECUTE | exactly `portal_view`, `portal_decide_scope`, `portal_request_revision`, `portal_decide_change_order`, `health` |
| `authenticated` can EXECUTE | exactly the 16 freelancer functions plus the 5 above |
| Executable via `PUBLIC` | nothing |
| Internal helpers (`_portal_gate`, `_rate_hit`, `_issue_link`, `_new_token`, `_log`, …) | not callable by `anon` or `authenticated` |
| Freelancer functions | every one checks the caller (`_owned_project` / `_uid()` / `auth.uid()`) |
| Portal functions | every one goes through `_portal_gate` |

Behavioural tests in `tests/db/workflow.test.ts` confirm the same rules in practice:
- users can't read or act on another user's projects
- direct table writes are refused
- immutable records reject updates, even from the database owner
- link tokens are never stored
- expired and revoked links fail everywhere

---

## 3. Secrets in the build output

`npm run audit:secrets` builds the app with a realistic public configuration (an anon-role JWT and a
Turnstile site key), then scans:
- **the build output (29 files):** any JWT whose role isn't `anon`, Supabase secret keys, private-key blocks, AWS/Stripe/Resend/GitHub/Slack/Google tokens, database URLs with passwords, names of server-only variables, source maps, dotenv files
- **all 68 tracked repository files:** the same patterns, plus committed dotenv files

**Result: no secrets found.** The build contains only:
- the Supabase URL and anon key, both public by design (access is enforced by RLS and database functions)
- the optional Turnstile site key, which is also public

The scanner's own test fixtures are assembled at runtime, so the repository holds no secret-shaped strings.

- The project has **no server secrets at all**: no service-role key, no email key, no token-encryption key.
- `wrangler.jsonc` contains only public placeholders.
- Test-only values (a local JWT signing string in `tests/e2e/stack.mjs`) are used solely by the offline test stack and never reach the build.

---

## 4. Test results (this commit)

| Suite | Tests | Result |
|---|---|---|
| `tests/db/workflow.test.ts` — workflow, security, links, abuse limits, response shapes, notifications | 42 | ✅ pass |
| `tests/db/permissions.test.ts` — catalog-based permission audit | 15 | ✅ pass |
| `tests/db/rollback.test.ts` — teardown removes everything and the migration reinstalls; post-restore trigger script | 2 | ✅ pass |
| `.github/workflows/release.yml` — `actionlint` | — | ✅ no problems |
| `tests/db/release-sql.test.ts` — release automation SQL on real Postgres: fresh install, idempotent rerun, failed migration fully rolled back, unrecorded install refused, allowlist sync and closed-by-default, private bookkeeping schema | 7 | ✅ pass |
| `tests/unit/` — money/pricing, validation, link parsing, redirects, errors, Worker, CSP, portal errors, secret scanner | 33 | ✅ pass |
| `tests/unit/release-deploy.test.ts` — release automation with simulated Supabase/Cloudflare/live site: waits without tokens, full deploy, subdomain registration, provisioning wait, account ambiguity, missing CSP and data-leak detection, Supabase token never passed to build/Cloudflare | 7 | ✅ pass |
| **Total (`npm test`)** | **106** | ✅ **pass** |
| TypeScript (`npm run typecheck`) | — | ✅ pass |
| Secret scan (`npm run audit:secrets`) | build + repo | ✅ pass |
| Dependency audit (`npm run audit:deps`) | 116 packages | ✅ pass — all open source, no paid-service SDKs |
| Pre-deploy guard (`scripts/predeploy-check.mjs`) | 3 scenarios | ✅ blocks placeholders and local or mismatched builds; passes a consistent build |
| End-to-end (`tests/e2e/run.sh`) — built app served by Cloudflare's runtime (`wrangler dev`), Chrome as freelancer (desktop) and client (phone) | 21 steps | ✅ pass, no browser errors |

End-to-end coverage:
- sign-up without email confirmation, onboarding
- project creation with validation
- one-time link dialog and copying the link
- client rejects, freelancer revises, client approves
- the revision scope check
- an hourly change order, proposed and approved
- a payment recorded
- in-app notifications
- link replacement and revocation
- malformed links
- cross-account isolation
- signed-out redirect
- sign-out and sign-in
- no horizontal scroll on mobile

Routing and headers were also checked in Cloudflare's runtime:
- page navigations get `index.html` with the CSP
- hashed assets get a one-year immutable cache
- `/p` gets `noindex` and `no-store`
- only stray non-navigation requests reach the Worker

---

The 21st end-to-end step proves the rate limits work through the real API path. A phone browser
loads 20 random links, and then even a valid link is refused with "Too many requests". The client IP
travelled gateway → PostgREST `request.headers` → `_portal_gate`.

The release-readiness additions (92nd test, dependency audit, pre-deploy guard, rollback scripts) are
described in [DEPLOYMENT.md](DEPLOYMENT.md).

## 5. Residual risks (accepted or to verify)

1. **IP-based limits depend on Supabase's gateway headers.** They need `cf-connecting-ip` or `x-real-ip` in `request.headers`. If Supabase provides neither, IP limits are silently skipped and per-link limits still apply. *Verify after deploy* (§6).
2. **Limits are enforced inside the database.** Limited requests still reach Supabase and use a little compute and egress. Edge rate limiting would mean routing portal traffic through the Worker; out of scope for ₹0.
3. **Fixed windows** allow a short burst of up to twice a limit across a window boundary. Acceptable for this purpose.
4. **A widely shared or scraped link** can hit its own read limit. The freelancer can replace the link.
5. **No email verification.** Mitigated by the beta allowlist (recommended) and optional Turnstile.
6. **Session in `localStorage`.** Mitigated by a strict CSP (no inline or third-party scripts) and React escaping.
7. **`style-src 'unsafe-inline'`.** Needed for React style attributes. Low risk; scripts remain strict.
8. **Tested against a local stand-in, not real Supabase.** The stand-in is real Postgres (PGlite) plus the real PostgREST 12 and a minimal auth shim. Supabase Auth settings (confirmation off, password length, CAPTCHA) must be configured as documented and smoke-tested.
9. **No automatic backups** on Supabase Free. Export periodically.
10. **No third-party penetration test** has been performed.

## 6. Deployment

The step-by-step checklist, Supabase setup, migration, allowlist, Cloudflare commands, post-deploy
verification (including the IP-limit check from residual risk 1), backups and rollback are in
**[DEPLOYMENT.md](DEPLOYMENT.md)**. Deployment requires your explicit approval.

Reference: Cloudflare Turnstile CSP guidance — https://developers.cloudflare.com/turnstile/reference/content-security-policy/
