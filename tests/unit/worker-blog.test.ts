import { describe, expect, it } from "vitest";
import { serveBlog } from "../../worker/index";
import { blogRoute, dehydrated } from "../../worker/blog";

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const SHELL = `<!doctype html><html><head><meta name="description" content="x" /><title>ScopeFlow</title><meta property="og:title" content="x" /><meta property="og:description" content="x" /><meta property="og:url" content="https://scopeflow.in/" /></head><body><div id="root"></div><noscript>ScopeFlow needs JavaScript enabled.</noscript></body></html>`;
const assets = { fetch: async (r: Request) => (new URL(r.url).pathname === "/sitemap.xml" ? new Response("<urlset>static</urlset>") : new Response(SHELL, { headers: { "content-type": "text/html" } })) };
const env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon", ASSETS: assets };
const POST = {
  slug: "logo-prices-2026",
  title: 'Logo prices in 2026 <script>alert("x")</script>',
  description: "What Indian freelancers charge for logos & why.",
  category: "market-prices",
  body: "## Ranges\n\n| Level | Price |\n|---|---|\n| Junior | ₹5,000 |\n\n<img src=x onerror=alert(1)>",
  author_name: "Prakash",
  published_at: "2026-11-02T10:00:00Z",
  updated_at: "2026-11-02T12:00:00Z",
};
function db(posts = [POST], fail = false) {
  const calls: string[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    calls.push(url);
    expect((init.headers as Record<string, string>).apikey).toBe("anon");
    if (fail) return new Response("{}", { status: 500 });
    const u = new URL(url);
    const slug = u.searchParams.get("slug");
    const rows = slug ? posts.filter((p) => `eq.${p.slug}` === slug) : posts.map(({ body: _b, ...rest }) => rest);
    return new Response(JSON.stringify(rows));
  };
  return { f, calls };
}
const get = (path: string, f = db().f) => serveBlog(new Request(`https://scopeflow.in${path}`), env, f);

describe("blog routes", () => {
  it("recognises only blog paths", () => {
    expect(blogRoute("/blog")).toEqual({ kind: "list" });
    expect(blogRoute("/blog/logo-prices-2026")).toEqual({ kind: "post", slug: "logo-prices-2026" });
    expect(blogRoute("/blog/write")).toEqual({ kind: "app" });
    expect(blogRoute("/blog/rss.xml")).toEqual({ kind: "rss" });
    expect(blogRoute("/sitemap.xml")).toEqual({ kind: "sitemap" });
    expect(blogRoute("/blog/Bad Slug")).toBeNull();
    expect(blogRoute("/dashboard")).toBeNull();
  });
});

describe("Worker-rendered blog pages", () => {
  it("renders a post with its own head, structured data, escaped content and embedded data", async () => {
    const res = (await get("/blog/logo-prices-2026"))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    const html = await res.text();
    expect(html).toContain("<title>Logo prices in 2026 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; | ScopeFlow blog</title>");
    expect(html).toContain('<link rel="canonical" href="https://scopeflow.in/blog/logo-prices-2026" />');
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('data-ssr="/blog/logo-prices-2026"');
    expect(html).toContain("<td>₹5,000</td>");
    expect(html).not.toMatch(/<script>alert|<img src=x/);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)![1]);
    expect(ld["@graph"][1]).toMatchObject({ "@type": "BlogPosting", datePublished: POST.published_at, dateModified: POST.updated_at, author: { name: "Prakash" } });
    const state = JSON.parse(html.match(/id="sf-state">(.+?)<\/script>/)![1]);
    expect(state.queries.map((q: { queryKey: unknown }) => q.queryKey)).toEqual([["blog", "post", "logo-prices-2026"], ["blog", "list"]]);
    expect(html).not.toContain("needs JavaScript");
  });

  it("answers 404 (noindex) for a missing post, and redirects a trailing slash", async () => {
    const res = (await get("/blog/no-such-post"))!;
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<meta name="robots" content="noindex" />');
    const r = (await get("/blog/logo-prices-2026/"))!;
    expect([r.status, r.headers.get("location")]).toEqual([301, "https://scopeflow.in/blog/logo-prices-2026"]);
  });

  it("renders the list, the writer page shell, and leaves other paths alone", async () => {
    const list = await (await get("/blog"))!.text();
    expect(list).toContain('href="/blog/logo-prices-2026"');
    expect(list).toContain("<title>Freelancing blog: pricing, clients and growth | ScopeFlow</title>");
    const write = await (await get("/blog/write"))!.text();
    expect(write).toContain('<div id="root"></div>');
    expect(await get("/dashboard")).toBeNull();
    expect(await serveBlog(new Request("https://scopeflow.in/blog", { method: "POST" }), env, db().f)).toBeNull();
  });

  it("lists every post in the sitemap and the RSS feed", async () => {
    const sm = await (await get("/sitemap.xml"))!.text();
    expect(sm).toContain("<loc>https://scopeflow.in/</loc>");
    expect(sm).toContain("<loc>https://scopeflow.in/blog/logo-prices-2026</loc><lastmod>2026-11-02T12:00:00Z</lastmod>");
    const feed = (await get("/blog/rss.xml"))!;
    expect(feed.headers.get("content-type")).toContain("application/rss+xml");
    expect(await feed.text()).toContain("<title>Logo prices in 2026 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>");
  });

  it("falls back gracefully when the database is down", async () => {
    const page = (await get("/blog/logo-prices-2026", db([], true).f))!;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');
    expect(await (await get("/sitemap.xml", db([], true).f))!.text()).toBe("<urlset>static</urlset>");
  });

  it("embeds data in TanStack Query's format", () => {
    expect(dehydrated([[["blog", "list"], []]]).queries[0]).toMatchObject({ queryHash: '["blog","list"]', state: { status: "success", data: [] } });
  });
});
