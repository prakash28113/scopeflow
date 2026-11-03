/**
 * Blog pages for search engines and link previews, rendered by the Worker on each request:
 *   /blog, /blog/<slug>, /blog/rss.xml and /sitemap.xml (static pages + every published post).
 * (wrangler.jsonc sends these paths to the Worker first: assets.run_worker_first.)
 *
 * Posts are read from Supabase with the public key (row security returns only published posts), put
 * into the app shell with the page's own title, description, canonical address and schema.org data,
 * and embedded as data so the app takes over in the browser without loading them again.
 * Every author-written character is HTML-escaped (renderMarkdown escapes before formatting).
 */
import {
  CATEGORIES,
  LIST_COLUMNS,
  POST_COLUMNS,
  categoryOf,
  escapeHtml,
  formatPostDate,
  imagePrefix,
  readingMinutes,
  renderMarkdown,
  type BlogPost,
} from "../src/lib/blog-content";
import { OG_IMAGE, PUBLIC_PAGES, SITE_NAME, SITE_URL, canonicalUrl } from "../src/lib/seo-pages";
import { OPERATOR_NAME } from "../src/lib/operator";

export const BLOG_TITLE = "Freelancing blog: pricing, clients and growth | ScopeFlow";
export const BLOG_DESCRIPTION =
  "Practical advice for freelancers in India: pricing and market rates, winning and keeping clients, scope, contracts, tools and success stories.";

type ListItem = Omit<BlogPost, "body">;
export type BlogEnv = { SUPABASE_URL: string; SUPABASE_ANON_KEY: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

async function rest<T>(env: BlogEnv, f: Fetch, query: string): Promise<T> {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const res = await f(`${base}/rest/v1/blog_posts?${query}`, { headers: { apikey: env.SUPABASE_ANON_KEY, accept: "application/json" } });
  if (!res.ok) throw new Error(`blog: database answered ${res.status}`);
  return (await res.json()) as T;
}

export const listPosts = (env: BlogEnv, f: Fetch) =>
  rest<ListItem[]>(env, f, `select=${encodeURIComponent(LIST_COLUMNS.replace(/\s/g, ""))}&order=published_at.desc&limit=100`);
export const getPost = async (env: BlogEnv, f: Fetch, slug: string) =>
  (await rest<BlogPost[]>(env, f, `select=${encodeURIComponent(POST_COLUMNS.replace(/\s/g, ""))}&slug=eq.${encodeURIComponent(slug)}&limit=1`))[0] ?? null;

/** TanStack Query's dehydrated format, so the app starts with this data (see src/main.tsx). */
export function dehydrated(entries: [readonly unknown[], unknown][]) {
  const now = Date.now();
  return {
    mutations: [],
    queries: entries.map(([queryKey, data]) => ({
      queryKey,
      queryHash: JSON.stringify(queryKey),
      state: {
        data,
        dataUpdateCount: 1,
        dataUpdatedAt: now,
        error: null,
        errorUpdateCount: 0,
        errorUpdatedAt: 0,
        fetchFailureCount: 0,
        fetchFailureReason: null,
        fetchMeta: null,
        isInvalidated: false,
        status: "success",
        fetchStatus: "idle",
      },
    })),
  };
}

type Page = { path: string; title: string; description: string; url: string; body: string; jsonLd: unknown; state: unknown; noindex?: boolean; ogType?: string; image?: string | null };

/** Fills the app shell (index.html) with the page. */
export function fillShell(shell: string, p: Page): string {
  const meta = (attr: string, key: string, content: string, html: string) => {
    const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*"\\s*/?>`);
    const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
    return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
  };
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(p.title)}</title>`);
  html = meta("name", "description", p.description, html);
  html = meta("property", "og:title", p.title, html);
  html = meta("property", "og:description", p.description, html);
  html = meta("property", "og:url", p.url, html);
  html = meta("property", "og:type", p.ogType ?? "website", html);
  if (p.image) {
    html = meta("property", "og:image", p.image, html);
    // The site's default image size doesn't describe an uploaded photo.
    html = html.replace(/\s*<meta property="og:image:(width|height|alt)" content="[^"]*"\s*\/?>/g, "");
  }
  const head = [
    `<link rel="canonical" href="${escapeHtml(p.url)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="ScopeFlow blog" href="${SITE_URL}/blog/rss.xml" />`,
    p.noindex ? `<meta name="robots" content="noindex" />` : "",
    `<script type="application/ld+json">${json(p.jsonLd)}</script>`,
  ].filter(Boolean);
  html = html.replace("</head>", `    ${head.join("\n    ")}\n  </head>`);
  html = html.replace(/\s*<noscript>ScopeFlow needs JavaScript enabled\.<\/noscript>/, "");
  return html.replace(
    '<div id="root"></div>',
    `<div id="root" data-ssr="${escapeHtml(p.path)}">${p.body}</div>\n    <script type="application/json" id="sf-state">${json(p.state)}</script>`,
  );
}

const header = `<header class="border-b border-line bg-surface/80"><div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"><div class="flex items-center gap-3"><a href="/" aria-label="ScopeFlow home" class="text-[15px] font-semibold text-ink">ScopeFlow</a><span class="h-5 w-px bg-line" aria-hidden="true"></span><a href="/blog" class="text-[14px] font-semibold text-ink">Blog</a></div><nav class="flex items-center gap-2" aria-label="Blog"><a href="/pricing" class="px-2 text-[14px] font-medium text-ink-2 sm:px-3">Pricing</a><a href="/signup" class="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white">Start free</a></nav></div></header>`;

const card = (p: ListItem) => {
  const c = categoryOf(p.category);
  const img = p.cover_image ? `<img src="${escapeHtml(p.cover_image)}" alt="" loading="lazy" class="mb-4 aspect-[16/9] w-full rounded-xl object-cover">` : "";
  return `<article><a href="/blog/${escapeHtml(p.slug)}">${img}<p class="text-[12px] font-semibold uppercase tracking-[0.06em]" style="color:${c.tone}">${escapeHtml(c.label)}</p><h2 class="mt-1.5 text-[18px] font-semibold leading-snug text-ink">${escapeHtml(p.title)}</h2></a><p class="mt-2 text-[14px] text-ink-2">${escapeHtml(p.description)}</p><p class="mt-3 text-[13px] text-muted"><time datetime="${escapeHtml(p.published_at)}">${formatPostDate(p.published_at)}</time></p></article>`;
};

const ORG = { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: SITE_NAME, url: `${SITE_URL}/`, logo: `${SITE_URL}/icon-512.png` };

export function listPage(posts: ListItem[]): Page {
  const body = `<div class="min-h-dvh bg-canvas">${header}<main class="mx-auto max-w-6xl px-4 pb-8 pt-10 sm:px-6 sm:pt-14"><div class="max-w-2xl"><p class="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">The ScopeFlow blog</p><h1 class="display mt-3 text-[38px] font-semibold leading-[1.05] text-ink sm:text-[52px]">Run your freelance business better.</h1><p class="mt-4 text-[17px] leading-relaxed text-ink-2">${escapeHtml(BLOG_DESCRIPTION)}</p></div><nav class="mt-8 flex flex-wrap gap-2" aria-label="Categories">${CATEGORIES.map((c) => `<a href="/blog?category=${c.id}" class="rounded-full border border-line px-3.5 py-1.5 text-[13px]">${escapeHtml(c.label)}</a>`).join("")}</nav><div class="mt-10 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">${posts.map(card).join("")}</div></main></div>`;
  return {
    path: "/blog",
    title: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    url: `${SITE_URL}/blog`,
    body,
    state: dehydrated([[["blog", "list"], posts]]),
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        ORG,
        {
          "@type": "Blog",
          "@id": `${SITE_URL}/blog#blog`,
          name: "The ScopeFlow blog",
          description: BLOG_DESCRIPTION,
          url: `${SITE_URL}/blog`,
          publisher: { "@id": ORG["@id"] },
          inLanguage: "en-IN",
          blogPost: posts.slice(0, 20).map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE_URL}/blog/${p.slug}`, datePublished: p.published_at })),
        },
      ],
    },
  };
}

export function postPage(post: BlogPost, posts: ListItem[], supabaseUrl = ""): Page {
  const c = categoryOf(post.category);
  const url = `${SITE_URL}/blog/${post.slug}`;
  const body = `<div class="min-h-dvh bg-canvas">${header}<main><article class="mx-auto max-w-[720px] px-4 pb-6 pt-10 sm:px-6 sm:pt-14"><nav aria-label="Breadcrumb" class="text-[13px] text-muted"><a href="/blog">Blog</a> / <a href="/blog?category=${c.id}" style="color:${c.tone}">${escapeHtml(c.label)}</a></nav><h1 class="display mt-4 text-[34px] font-semibold leading-[1.08] text-ink sm:text-[46px]">${escapeHtml(post.title)}</h1><p class="mt-4 text-[18px] leading-relaxed text-ink-2">${escapeHtml(post.description)}</p><p class="mt-5 text-[14px] text-muted"><span class="font-medium text-ink">${escapeHtml(post.author_name)}</span> · <time datetime="${escapeHtml(post.published_at)}">${formatPostDate(post.published_at)}</time> · ${readingMinutes(post.body)} min read</p>${post.cover_image ? `<img src="${escapeHtml(post.cover_image)}" alt="${escapeHtml(post.title)}" class="mt-8 aspect-[5/2] w-full rounded-2xl object-cover">` : ""}<div class="blog-prose mt-10">${renderMarkdown(post.body, { imagePrefix: supabaseUrl ? imagePrefix(supabaseUrl) : undefined })}</div></article></main></div>`;
  return {
    path: `/blog/${post.slug}`,
    title: `${post.title} | ScopeFlow blog`,
    description: post.description,
    url,
    body,
    ogType: "article",
    image: post.cover_image,
    state: dehydrated([
      [["blog", "post", post.slug], post],
      [["blog", "list"], posts],
    ]),
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        ORG,
        {
          "@type": "BlogPosting",
          "@id": `${url}#post`,
          headline: post.title,
          description: post.description,
          articleSection: c.label,
          datePublished: post.published_at,
          dateModified: post.updated_at,
          wordCount: post.body.trim().split(/\s+/).length,
          author: { "@type": "Person", name: post.author_name || OPERATOR_NAME },
          publisher: { "@id": ORG["@id"] },
          image: post.cover_image || OG_IMAGE,
          url,
          mainEntityOfPage: url,
          inLanguage: "en-IN",
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Blog", item: `${SITE_URL}/blog` },
            { "@type": "ListItem", position: 2, name: c.label, item: `${SITE_URL}/blog?category=${c.id}` },
            { "@type": "ListItem", position: 3, name: post.title, item: url },
          ],
        },
      ],
    },
  };
}

export function notFoundPage(slug: string): Page {
  return {
    path: `/blog/${slug}`,
    title: "Post not found | ScopeFlow blog",
    description: BLOG_DESCRIPTION,
    url: `${SITE_URL}/blog/${slug}`,
    body: "",
    noindex: true,
    state: dehydrated([[["blog", "post", slug], null]]),
    jsonLd: { "@context": "https://schema.org", "@graph": [ORG] },
  };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sitemap(posts: ListItem[]): string {
  const urls = [
    ...Object.entries(PUBLIC_PAGES).map(([path, p]) => `  <url><loc>${xml(canonicalUrl(path))}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`),
    `  <url><loc>${SITE_URL}/blog</loc>${posts[0] ? `<lastmod>${xml(posts[0].updated_at)}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ...posts.map((p) => `  <url><loc>${SITE_URL}/blog/${xml(p.slug)}</loc><lastmod>${xml(p.updated_at)}</lastmod><priority>0.6</priority></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function rss(posts: ListItem[]): string {
  const items = posts.slice(0, 30).map(
    (p) =>
      `    <item><title>${xml(p.title)}</title><link>${SITE_URL}/blog/${xml(p.slug)}</link><guid isPermaLink="true">${SITE_URL}/blog/${xml(p.slug)}</guid><description>${xml(p.description)}</description><category>${xml(categoryOf(p.category).label)}</category><pubDate>${new Date(p.published_at).toUTCString()}</pubDate></item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>The ScopeFlow blog</title>\n    <link>${SITE_URL}/blog</link>\n    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />\n    <description>${xml(BLOG_DESCRIPTION)}</description>\n    <language>en-in</language>\n${items.join("\n")}\n  </channel>\n</rss>\n`;
}

/** Which blog route a path is, or null when it isn't one the Worker renders. */
export function blogRoute(pathname: string): { kind: "list" } | { kind: "post"; slug: string } | { kind: "rss" } | { kind: "sitemap" } | { kind: "app" } | null {
  if (pathname === "/sitemap.xml") return { kind: "sitemap" };
  if (pathname === "/blog") return { kind: "list" };
  if (pathname === "/blog/rss.xml") return { kind: "rss" };
  if (pathname === "/blog/write") return { kind: "app" };
  const m = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  return m ? { kind: "post", slug: m[1] } : null;
}
