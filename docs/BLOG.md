# Blog

Public blog at `/blog`: posts in five categories (Strategies, Success stories, Market prices, Tools, News).
The 3 newest posts appear on the home page.

## Writing (in the app)

Authors (emails in `config/public-site.json` → `blogAuthors`, synced by each release) see **Blog** in the
sidebar: write or paste a post (Markdown), preview, then **Publish**. Published posts keep their address when
edited. "Unpublish" hides a post; "Delete" removes it.

## Posting from a tool (publishing keys)

Blog → **Publishing keys** → Create key. The key is shown once; only its SHA-256 hash is stored. Give it only
to the tool that posts for you (never paste it into a chat, email or document). Revoke it there at any time.

```
POST https://<project-ref>.supabase.co/functions/v1/blog/posts
Authorization: Bearer sfblog_…
Content-Type: application/json

{ "title": "…", "description": "20–200 characters", "category": "market-prices", "body": "## Markdown…", "draft": false }
```

Posts are published immediately (or saved as drafts with `"draft": true`), as the key's author, up to 20 a day
per key. The reply includes the post's address. `GET …/functions/v1/blog` describes the fields.

The Grok app itself can't call web addresses; a tool that can (an automation service, or a script using
xAI's paid API) sends the posts. Without one, copy Grok's text into **Write a post**.

## Search engines

`/blog`, `/blog/<post>`, `/blog/rss.xml` and `/sitemap.xml` are rendered by the Worker (`worker/blog.ts`,
`assets.run_worker_first` in `wrangler.jsonc`) with each post's title, description, canonical address and
`BlogPosting` data; the sitemap lists every published post. Missing posts answer 404 with noindex.

Check AI-written posts before or soon after they go live: invented prices, statistics or "success stories"
mislead readers, and Google's spam policies target mass-produced unhelpful content.

## Checks

`tests/db/blog.test.ts`, `tests/unit/markdown.test.ts` (including script-injection attempts),
`tests/unit/blog-api.test.ts`, `tests/unit/worker-blog.test.ts`, and the e2e step "blog".
