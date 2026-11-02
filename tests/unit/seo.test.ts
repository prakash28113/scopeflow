import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES, canonicalUrl, structuredData, type PublicPath } from "@/lib/seo";
import { HOME_FAQ, PRICING_FAQ } from "@/lib/faq";
// @ts-expect-error plain ESM build script without types
import { pageHtml, sitemapXml } from "../../scripts/prerender.mjs";

const paths = Object.keys(PUBLIC_PAGES) as PublicPath[];

describe("public page metadata", () => {
  it("gives every page its own concise title and description", () => {
    const titles = new Set(paths.map((p) => PUBLIC_PAGES[p].title));
    expect(titles.size).toBe(paths.length);
    for (const p of paths) {
      const { title, description } = PUBLIC_PAGES[p];
      expect(title).toMatch(/ScopeFlow/);
      expect(title.length).toBeLessThanOrEqual(70);
      expect(description.length).toBeGreaterThan(50);
      expect(description.length).toBeLessThanOrEqual(160);
    }
    expect(PUBLIC_PAGES["/"].title.startsWith("ScopeFlow")).toBe(true);
  });

  it("uses the main address for canonical links", () => {
    expect(canonicalUrl("/")).toBe("https://scopeflow.in/");
    expect(canonicalUrl("/pricing")).toBe("https://scopeflow.in/pricing");
  });

  it("describes the organisation, site and product truthfully (no ratings or reviews)", () => {
    const home = structuredData("/") as { "@context": string; "@graph": Record<string, unknown>[] };
    expect(home["@context"]).toBe("https://schema.org");
    const types = home["@graph"].map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebPage", "SoftwareApplication", "FAQPage"]);
    const json = JSON.stringify(home);
    expect(json).not.toMatch(/"(aggregateRating|review|reviews|ratingValue|ratingCount)"/);
    expect(json).not.toMatch(/\bAI\b|artificial intelligence/i);
    const faq = home["@graph"].find((n) => n["@type"] === "FAQPage") as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(HOME_FAQ.length);
    const pricing = structuredData("/pricing") as { "@graph": Record<string, unknown>[] };
    expect((pricing["@graph"].find((n) => n["@type"] === "FAQPage") as { mainEntity: unknown[] }).mainEntity).toHaveLength(PRICING_FAQ.length);
    expect(structuredData("/privacy")["@graph"]).toHaveLength(3);
  });
});

describe("prerendered HTML", () => {
  const template = `<!doctype html><html><head>
    <meta name="description" content="old" />
    <title>Old</title>
    <meta property="og:title" content="old" />
    <meta property="og:description" content="old" />
    <meta property="og:url" content="https://scopeflow.in/" />
    <meta property="og:image" content="old" />
  </head><body><div id="root"></div>
    <noscript>ScopeFlow needs JavaScript enabled.</noscript><script type="module" src="/assets/x.js"></script></body></html>`;
  const html = pageHtml(template, {
    path: "/pricing",
    seo: { title: 'Pricing & "plans"', description: "Free <b>plan</b>" },
    body: "<h1>Pricing</h1>",
    state: { queries: [{ text: "</script><script>alert(1)</script>" }] },
    jsonLd: { name: "</script>" },
    fonts: ["inter-latin-wght-normal-abc.woff2"],
    canonical: "https://scopeflow.in/pricing",
    ogImage: "https://scopeflow.in/og.png",
  });

  it("writes the page's own head, escaped", () => {
    expect(html).toContain("<title>Pricing &amp; &quot;plans&quot;</title>");
    expect(html).toContain('<meta name="description" content="Free &lt;b&gt;plan&lt;/b&gt;" />');
    expect(html).toContain('<link rel="canonical" href="https://scopeflow.in/pricing" />');
    expect(html).toContain('<meta property="og:url" content="https://scopeflow.in/pricing" />');
    expect(html).toContain('href="/assets/inter-latin-wght-normal-abc.woff2" as="font" type="font/woff2" crossorigin');
    expect(html).not.toContain("needs JavaScript");
  });

  it("puts the page in #root and can't be broken out of by data", () => {
    expect(html).toContain('<div id="root" data-page="/pricing"><h1>Pricing</h1></div>');
    expect(html.match(/<\/script>/g)).toHaveLength(3); // JSON-LD, state, the app script: nothing injected
    expect(JSON.parse(html.match(/id="sf-state">(.+?)<\/script>/)![1]).queries[0].text).toContain("alert(1)");
  });

  it("refuses a template that isn't a fresh build", () => {
    expect(() => pageHtml(template.replace('<div id="root"></div>', '<div id="root">x</div>'), { path: "/", seo: { title: "t", description: "d" }, body: "", state: null, jsonLd: {}, fonts: [], canonical: "", ogImage: "" })).toThrow(/empty #root/);
  });

  it("lists every public page in the sitemap", () => {
    const xml = sitemapXml(PUBLIC_PAGES, canonicalUrl);
    for (const p of paths) expect(xml).toContain(`<loc>${canonicalUrl(p)}</loc>`);
  });
});
