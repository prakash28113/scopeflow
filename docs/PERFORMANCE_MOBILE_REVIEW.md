# Performance and mobile review

Base: `8cae200` (main, 15 November 2026). Branch: `performance-mobile`.

## Focused improvement

The public router eagerly imported the signed-in application shell. This pulled navigation, dashboard/reminder helpers and associated code into the entry dependency graph even for signed-out visitors. The shell now loads through React Router's existing lazy-route mechanism only for its matched protected routes. Loading and authentication guards remain shared, and their behavior is unchanged. Pricing and the anonymous client portal import those lightweight guards directly. Existing imports from `app-shell` remain supported.

No authentication, RLS, token, plan or authorization rules changed. No dependency was added.

## Reproducible build measurements

Built the base and branch with the same dependencies and configuration using `vite build --manifest`, target ES2022. Recursively summed the emitted manifest's `imports` graph from `index.html`, plus the page route chunk for each page below. Gzip figures use Node's `gzipSync` separately for every JavaScript file, matching per-file transfer compression. These are JavaScript asset sizes; they exclude CSS, fonts, images, API traffic, cache effects and transport overhead.

| JavaScript dependency graph | Before bytes | After bytes | Before gzip bytes | After gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| Entry only | 648605 | 614547 | 197553 | 185494 |
| Homepage including entry | 685652 | 660038 | 210378 | 202262 |
| Anonymous portal including entry | 817999 | 790695 | 250910 | 241432 |
| Pricing including entry | 677973 | 645826 | 209761 | 198759 |

The homepage graph is 8116 gzip bytes smaller (3.86%); the anonymous portal saves 9478 (3.78%); pricing saves 11002 (5.25%). This does **not** establish an LCP, INP or conversion improvement.

## Existing protections retained

The existing homepage already prerenders public HTML, prioritizes a responsive WebP hero, delays hydration until its first painted frame, reserves image dimensions, lazy-loads below-fold media, and respects reduced-motion preferences. These implementations and their regression tests were preserved.

Existing browser walkthroughs cover public headers at 320, 360, 375 and 412px; a 390×844 touch viewport covers the homepage, freelancer dashboard and client portal. They must pass for this branch before release. The new route-guard tests cover loading, failed/missing profile recovery, onboarding, signed-in content and denial of content without a session.

## Remaining verification

A live-browser inspection was attempted but the cloud browser timed out during tab creation and recovery. No reliable new LCP, INP, CLS, slow-network or visual measurements were obtained. No production account was created or modified. Confirm the full browser workflow and capture before/after mobile metrics in a stable preview environment before claiming completion of Phase 4.

## Validation

- TypeScript check: passed.
- Production build and all six public-page prerenders: passed.
- Focused route-guard, lazy-routing and existing hero/LCP regression tests: 12 passed.
- Secret scan and dependency/license audit: passed.
- Full unit/database suite: 593 tests passed across 75 files (`npm test -- --maxWorkers=2`, 163.25 seconds).
- Unit suite in Pacific/Honolulu, Pacific/Kiritimati and Asia/Kolkata: 357 tests passed in each zone with one worker.
- Browser walkthrough, PostgreSQL concurrency Actions job, live mobile measurements and remote CI: pending.

The first unrestricted local test invocation spawned 74 workers and suffered operating-system SIGKILL worker exits under shared-host memory pressure; 494 tests passed before those errors. The complete bounded-worker rerun passed; no tests or assertions were removed.
