import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES, structuredData } from "@/lib/seo-pages";
import worker, { pathRedirect } from "../../worker/index";

type Node = Record<string, unknown>;
const graph = (path: "/" | "/pricing") => (structuredData(path) as { "@graph": Node[] })["@graph"];
const APP = "https://scopeflow.in/#app";

describe("T2-07 /pricing structured data is the app and its plans, not a shop product", () => {
  it("has no Product node; the app node carries the offers", () => {
    const g = graph("/pricing");
    expect(JSON.stringify(g)).not.toContain('"Product"');
    const app = g.find((n) => n["@id"] === APP)!;
    expect(app).toMatchObject({
      "@type": ["SoftwareApplication", "WebApplication"],
      name: "ScopeFlow",
      url: "https://scopeflow.in/",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web browser",
      image: "https://scopeflow.in/og.png?v=3",
      publisher: { "@id": "https://scopeflow.in/#organization" },
    });
    const page = g.find((n) => n["@type"] === "WebPage")!;
    expect(page.mainEntity).toEqual({ "@id": APP });
    expect(page.about).toEqual({ "@id": APP });
    // Nothing invented: no ratings, reviews or merchant fields.
    expect(JSON.stringify(g)).not.toMatch(/"(aggregateRating|review|reviews|ratingValue|availability|shippingDetails|hasMerchantReturnPolicy|sku|gtin\d*)"/);
  });
  it("prices are unchanged and in rupees", () => {
    const offers = graph("/pricing").find((n) => n["@id"] === APP)!.offers as Node[];
    expect(offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
      ["Free plan", "0", "INR"],
      ["Solo plan, monthly", "499", "INR"],
      ["Solo plan, yearly", "4999", "INR"],
      ["Studio plan, monthly", "999", "INR"],
      ["Studio plan, yearly", "9999", "INR"],
    ]);
    expect(graph("/").find((n) => n["@id"] === APP)!.offers).toEqual(offers);
  });
  it("the home page's app node has the same stable id and both types", () => {
    const app = graph("/").find((n) => n["@id"] === APP)!;
    expect(app["@type"]).toEqual(["SoftwareApplication", "WebApplication"]);
  });
  it("robots and noindex settings are untouched", () => {
    expect(Object.keys(PUBLIC_PAGES)).toEqual(["/", "/pricing", "/privacy", "/terms", "/refunds", "/contact"]);
  });
});

describe("T2-07 one address per page (301)", () => {
  const go = (path: string, init: RequestInit = {}) => pathRedirect(new Request(`https://scopeflow.in${path}`, init));
  const loc = (path: string) => {
    const r = go(path);
    return r ? [r.status, r.headers.get("location")] : null;
  };
  it("drops a trailing slash", () => {
    expect(loc("/pricing/")).toEqual([301, "https://scopeflow.in/pricing"]);
    expect(loc("/privacy/")).toEqual([301, "https://scopeflow.in/privacy"]);
    expect(loc("/terms//")).toEqual([301, "https://scopeflow.in/terms"]);
    expect(loc("/blog/")).toEqual([301, "https://scopeflow.in/blog"]);
    expect(loc("/pricing/?utm_source=x")).toEqual([301, "https://scopeflow.in/pricing?utm_source=x"]);
    expect(loc("/projects/abc/")).toEqual([301, "https://scopeflow.in/projects/abc"]);
  });
  it("/home, /index.html and .html addresses go to the canonical page", () => {
    expect(loc("/home")).toEqual([301, "https://scopeflow.in/"]);
    expect(loc("/home/")).toEqual([301, "https://scopeflow.in/"]);
    expect(loc("/home.html")).toEqual([301, "https://scopeflow.in/"]);
    expect(loc("/index.html")).toEqual([301, "https://scopeflow.in/"]);
    expect(loc("/pricing.html")).toEqual([301, "https://scopeflow.in/pricing"]);
  });
  it("leaves canonical addresses, files and non-GET requests alone", () => {
    for (const path of ["/", "/pricing", "/blog/some-post", "/p?t=abc", "/assets/app-1.js", "/og.png", "/homepage", "/home-office"]) expect(loc(path), path).toBeNull();
    expect(go("/pricing/", { method: "POST" })).toBeNull();
  });
  it("the Worker answers them before anything else", async () => {
    const env = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: "anon", ASSETS: { fetch: async () => new Response("asset") } };
    const r = await worker.fetch(new Request("https://scopeflow.in/home"), env as never);
    expect([r.status, r.headers.get("location")]).toEqual([301, "https://scopeflow.in/"]);
    const t = await worker.fetch(new Request("https://scopeflow.in/pricing/"), env as never);
    expect([t.status, t.headers.get("location")]).toEqual([301, "https://scopeflow.in/pricing"]);
    // http://www still becomes https://scopeflow.in first, then the path is tidied on the next hop.
    const w = await worker.fetch(new Request("http://www.scopeflow.in/pricing/"), env as never);
    expect([w.status, w.headers.get("location")]).toEqual([301, "https://scopeflow.in/pricing/"]);
  });
});
