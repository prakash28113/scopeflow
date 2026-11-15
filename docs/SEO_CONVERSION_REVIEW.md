# SEO and signup review

Reviewed against main `8cae200` on 15 November 2026. This is a repository review and a focused patch, not a claim of improved rankings or conversion rates.

## Existing protections retained

Six public pages are prerendered at build time with distinct titles, descriptions, canonical URLs and structured data. The Worker renders published blog posts, RSS and a sitemap containing public pages plus published articles. Live-host HTTP/www and duplicate file/trailing-slash addresses redirect. Private routes and authentication pages remain excluded from indexing; unknown pages return 404. Structured data contains no fabricated ratings or testimonials. Pricing and plan limits are unchanged.

## Changes

- Filtered blog navigation now keeps `/blog` as its canonical URL, matching the Worker response rather than changing the canonical after hydration.
- Public prerendered pages and Worker blog pages have explicit Twitter titles, descriptions and images. Browser navigation updates social titles, descriptions, image and page type. Leaving a blog article restores the site image and website type.
- Article images still pass the existing trusted Supabase storage validation before entering social metadata. External image URLs remain rejected. No CSP, image policy or upload grants changed.
- Signup attribution stores only the external referring origin. Paths, query strings, fragments and embedded credentials are discarded. Previously saved referrers are also minimised before being sent on signup. Existing campaign fields, first-touch attribution, 30-day lifetime and database format remain compatible. Previously saved server-side profile values are not rewritten; decide separately whether historical attribution needs a reviewed retention/cleanup action. The privacy text explains this reduction.

## Measurement and conversion recommendations

The repository already captures first-touch campaign tags/referrers and hands them to the new account once. Its privacy policy describes Cloudflare Web Analytics; production configuration, dashboards and historical statistics were not available in this review. No new analytics service, dependency or personal-data collection was added.

Before claiming improvements, establish a weekly baseline and compare identical definitions and traffic sources:

| Stage | Suggested measurement | Privacy constraint |
| --- | --- | --- |
| Landing visit | Existing aggregate page-view analytics | No user IDs or URL query data |
| Signup intent | Aggregate Start free click count, grouped by placement | No email, client data or full URLs |
| Signup start | Aggregate signup form visit | Separate starts from successful registration |
| Registration | Existing account creation totals plus campaign attribution | Keep identifiers out of event payloads |
| Activation | Aggregate completed onboarding and first project totals | Never send project names or client details |
| Upgrade intent | Aggregate plan comparison/upgrade clicks | Distinguish intent from completed payment |
| Paid conversion | Verified billing webhook totals when sales are enabled | No payment details in analytics |

These events are recommendations, not implemented tracking. Review consent/privacy requirements and provider settings before adding them. Do not infer that a signup button click is a registration, or an upgrade click is a sale.

Keep the existing clear free-plan limits and no-card messaging near the main CTA. Prioritise mobile registration completion and first-project success before adding more marketing sections. Test one wording or placement change at a time after measurement exists; no guaranteed uplift is asserted.

## Proposed editorial queue — approval required before publishing

Priorities below are based on fit with ScopeFlow's actual workflows and likely reader tasks, not measured search volume. Validate demand against Search Console queries and customer questions. The live [blog index](https://scopeflow.in/blog), reviewed on 15 November 2026, already lists GST invoice format (12 November), revision limits (11 November), a change-order template (10 November), freelance quotations (4 November), and scope creep (3 November). Improve those articles first rather than publishing competing pages. Titles below describe reader tasks, not instructions to create duplicate articles.

| Priority | Topic / reader task | Original material to prepare | Relevant next step |
| --- | --- | --- | --- |
| 1 | Scope of work for a freelance design project | Annotated example covering inclusions, exclusions, revisions and approval | Create a scoped project |
| 1 | Improve existing change-order template article (10 November): respond to extra work | Add three original response templates and a worked change-order example to the existing article | Record a change order |
| 1 | Improve existing freelance quotation article (4 November) | Add a checklist covering expiry, deliverables, milestones and exclusions with an example quote | Prepare a quotation |
| 1 | Improve existing revision-limits article (11 November): what counts as one revision? | Add concrete examples distinguishing a revision from a new deliverable | Define revision limits |
| 1 | Improve existing scope-creep article (3 November) | Add an original example showing how an agreed scope changes and how to record the extra work | Review project scope |
| 2 | Client approval without another account | Explain the approval trail and safe handling of private links | Share an approval link |
| 2 | Track partial payments and overdue balances | Worked fictional numbers clearly labelled as examples | Record a payment |
| 2 | Price a freelance project from costs and available hours | Transparent calculation rather than unsupported market-rate claims | Review project profitability |
| 2 | Improve existing GST invoice-format article (12 November) | Have a qualified reviewer validate current official rules and the article; add a checklist distinguishing registered/unregistered situations | Prepare an appropriate invoice |
| 3 | Weekly freelance project review | Practical checklist for pending approvals, deadlines and payment follow-up | Review dashboard |
| 3 | Clear client communication at project handover | Original handover and sign-off templates | Close a project |

The annotated scope-of-work example is a possible new article only after checking it adds something distinct from the existing scope-creep guide. Draft opening for that example (unpublished):

> A project scope should let you and your client answer the same question: what will be delivered for the agreed price? Start with named deliverables, then write down what each includes, how many revisions are included, and what needs separate approval. If you are designing a five-page website, list the five pages. Explain whether copywriting, extra pages and ongoing maintenance are included. A short, specific scope is easier to use when a new request arrives than a long list of vague promises.

For tax content, verify current CBIC rules and obtain expert review before publication; this queue is not tax advice. No articles or production content were changed.

## Sources reviewed

- [ScopeFlow live blog index](https://scopeflow.in/blog): existing article inventory used to prioritise updates rather than duplicate topics.

- [Google: people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content): useful original material, clear authorship and accurate evidence.
- [Google: faceted navigation](https://developers.google.com/crawling/docs/faceted-navigation): filtered URLs need a deliberate crawl/canonical strategy. This patch preserves the existing unfiltered canonical rather than introducing a new indexing scheme.
- [Google: software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app): retain truthful app metadata; markup does not guarantee a rich result.
- [CBIC: invoice rules](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001): starting source for a future expert-reviewed invoice article, not permission to publish unchecked tax claims.

## Remaining validation

Browser assertions cover public social tags, SPA updates, filtered canonical consistency, trusted article covers and restoration of default metadata after leaving an article. PostgREST 12.2.12 and the local test dependencies are now installed. The shared local browser attempt was blocked before assertions ran: Chromium aborted because the workspace forbids the Unix socket used by its process singleton (`socket() failed: Operation not permitted`). This SEO branch has not completed its browser walkthrough. GitHub Actions/browser verification remains necessary before this phase can be marked complete. Live indexing, Search Console coverage, production analytics configuration and actual conversion rates require access to the corresponding dashboards.
