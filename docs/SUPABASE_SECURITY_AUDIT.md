# Supabase security audit — 15 November 2026

Base: `main` at `8cae200` (merge of PR #47). No production database, credentials, or Supabase dashboard was accessed. All reproduction and database writes used isolated local databases. The proposed migration has **not** been applied to production.

## Confirmed vulnerability

### SFA-001: queued portal mutations can outlive link revocation (medium)

`_portal_gate` checked the token before acquiring the project row lock. An owner transaction could revoke or rotate the link while a client write waited on that lock. Once the owner committed, the waiting write continued using its earlier authorization, without checking the link again. The same gap affected expiry while waiting. This requires possession of a formerly valid link and an overlapping transaction; it does not allow guessing tokens or reading arbitrary accounts.

Reproduction on unmodified main, using independent PostgreSQL 17.5 connections:

1. Create and approve an isolated project and retain its bearer token.
2. Begin an owner transaction and call `revoke_share_link`; leave it uncommitted so its project lock remains held.
3. Start an anonymous revision request with the old token. Observe that backend waiting on a database lock through `pg_stat_activity`.
4. Commit the owner transaction.
5. Before the fix the queued call returned `ok: true` and recorded revision 1, despite the revocation having committed first. The regression assertion expected `invalid_link` and failed.

Fix: migration `20261127000000_portal_revocation_gate.sql` revalidates the token after the project lock is acquired, using a fresh READ COMMITTED statement snapshot. Expiry uses `clock_timestamp()` so time spent waiting is included. Existing token shape, hashes, rate limits, RPC grants, and RLS policies remain intact. All public write entry points use this gate. A rollback script restores the previous definition and explicitly warns that doing so reintroduces the race.

Nine deterministic race regressions now cover revoke/rotate/expire crossed with scope decisions, revisions, and change-order decisions. They check that no forbidden mutation lands. The pre-existing nine PostgreSQL concurrency checks are also retained.

## Other tested conclusions

- All 33 application tables in `public` have RLS enabled. API roles have no direct table writes there. The two Storage policies intentionally permit blog-author uploads and deletions in the public `blog` bucket.
- The database has 116 public functions, including 73 SECURITY DEFINER functions. Catalog tests enforce the reviewed callable-function allowlists, empty pinned search paths, and absence of PUBLIC EXECUTE privileges. Internal helpers remain inaccessible to anon/authenticated; billing, publishing-key processing, and email dispatch entry points remain service-role only; admin functions are not exposed to API roles.
- Anonymous SQL access is limited to the plan catalogue and published blog posts. The portal requires the project-specific token; ownership is checked by freelancer mutation entry points. Token hashes and billing-provider identifiers retain column-level restrictions.
- New tests populate victim and second-account rows and check **all 23 private SELECT policies**, including column-only tables. They also attempt foreign identifiers through 30 freelancer mutation calls. No cross-account read/write bypass was reproduced.
- All four portal endpoints reject malformed, random, rotated, revoked, and expired tokens. Foreign deliverable/change-order identifiers cannot be used with another project's token. Existing tests additionally cover stale scope versions, rate limits, minimal responses, immutable records, and service-role boundaries.
- Invoice seller/buyer contact information is intentionally shared with the holder of that project's token. This is not equivalent to unrestricted profile/client access.

The generated [permission catalog](SUPABASE_PERMISSION_CATALOG.md) records every final public-table policy and function signature/privilege after all migrations, and names every applied migration. Review included the original 26 migration files, their DDL/grant/policy changes, and the effective function bodies after replacements; the proposed gate correction is migration 27.

## Potential risks and verification limits — not confirmed vulnerabilities

1. **Gateway header provenance:** IP throttling relies on `cf-connecting-ip` / `x-real-ip` being supplied or overwritten by the trusted gateway. The database deliberately ignores `X-Forwarded-For` for throttling. Production gateway header handling was not tested. If clients can forge the trusted headers, IP limits may be evaded; token/link limits still apply.
2. **Production drift and authentication settings:** this audit verifies the repository-defined schema, not the live project's actual grants, Auth configuration, JWT settings, migration history, or leaked credentials. Email-based blog-author allowlisting assumes a correctly verified identity. No takeover was demonstrated.
3. **Public blog uploads:** the blog Storage bucket is intentionally public. A draft post's uploaded image can be fetched by anyone who already knows its object URL, even before publication. Private draft media would require a separate product/storage design.
4. **Bearer-link sharing:** anyone holding an unexpired, unrevoked project token can act as that client. Revocation must be used after accidental sharing. This is the documented capability model, not a tenant-isolation bypass.

## Verification

- Isolated PGlite database: every repository migration applied; public grants, all RLS policies, function privileges, token handling, and cross-account regressions exercised.
- Independent real PostgreSQL 17.5 connections: all 18 concurrency checks passed, including the nine new authorization races.
- Full Vitest suite: 593 tests passed across 74 files. Unit tests passed in Honolulu, Kiritimati and Kolkata (351 per time zone). Typecheck, production build and secret/dependency audits passed locally. GitHub upload, pull-request creation and new Actions results remain pending; these local results do not establish passing PR checks. A passing source audit is not a statement that the live schema has been changed.

Local runner note: the embedded PostgreSQL package's bundled ICU libraries were present but their SONAME symlinks were missing in this workspace. Those dependency-directory links were restored. The local runner used TCP with Unix sockets disabled because this workspace disallows filesystem sockets. No database-test assertions or repository runner configuration were weakened; GitHub Actions runs the original runner unchanged except for the new tests.
