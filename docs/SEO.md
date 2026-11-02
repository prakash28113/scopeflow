# Search engines (SEO)

## What the build does

- `npm run build` runs `vite build`, then `scripts/prerender.mjs`, which renders the public pages to static HTML:
  `dist/home.html` (served at `/` by `public/_redirects`), `dist/pricing.html`, `dist/privacy.html`, `dist/terms.html`.
  Crawlers that don't run JavaScript see the full page, and visitors see it before the app's code loads.
- `dist/index.html` stays the empty app shell. Cloudflare serves it for every app address (`/dashboard`, `/p`, …), so
  app pages never show the home page's content, and the Worker's page fallback fetches the shell, not `/`.
- In the browser, `src/main.tsx` hydrates the prerendered markup (no flash, animations don't restart).
- Titles, descriptions, canonical addresses and schema.org data (Organization, WebSite, WebPage, SoftwareApplication,
  FAQPage) come from `src/lib/seo.ts`. `dist/sitemap.xml` is generated from the same list.
- Unknown addresses show "Page not found" with `noindex`. App pages are disallowed in `public/robots.txt`;
  client links and reset pages send `X-Robots-Tag: noindex`.
- Checks: `tests/unit/seo.test.ts`, the e2e step "search engines", `scripts/predeploy-check.mjs`, and the release's
  live check that `/` is the prerendered, indexable page.

## Adding a public page

1. Add the route in `src/routes/tree.tsx` and call `useSeo("/your-path")` in the page.
2. Add it to `PUBLIC_PAGES` in `src/lib/seo.ts` (title under ~60 characters, description under 160).
3. Keep the page free of browser-only code during render (use effects), so it can be prerendered.
4. Every claim must be true of the product today: no ratings, reviews, user counts or AI.

## Owner checklist (outside the code)

- Google Search Console: submit `https://scopeflow.in/sitemap.xml`, then URL Inspection → Request indexing for `/`.
- Bing Webmaster Tools: import the site from Search Console (also covers DuckDuckGo and Yahoo results).
- Links from other sites: your LinkedIn, X/Instagram bios, Product Hunt or similar launch posts, freelancer
  communities and directories. A brand name shared with other products ranks first only once enough sites link to it.
