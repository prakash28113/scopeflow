import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalRedirect, serveApp } from "../../worker/index";
import { isKnownPath } from "@/lib/known-routes";
import { captureSource, readSource, takeSource, SOURCE_TTL_MS } from "@/lib/signup-source";
import { PLAN_PRICES, PUBLIC_PAGES, structuredData } from "@/lib/seo-pages";
import { INSTAGRAM_URL, OPERATOR_NAME, SUPPORT_EMAIL } from "@/lib/operator";
import { formatMoney } from "@/lib/money";
import { DEFAULT_SAC } from "@/lib/gst";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("brand", () => {
  it("uses the ScopeFlow name, the owner's spelling and the support address", () => {
    expect(OPERATOR_NAME).toBe("Prakash Mummidisetti");
    expect(SUPPORT_EMAIL).toBe("support@scopeflow.in");
    expect(INSTAGRAM_URL).toBe("https://www.instagram.com/scope_flow_official/");
    expect(PUBLIC_PAGES["/"].title).toBe("ScopeFlow: get paid for every “just one small change”");
    expect(PUBLIC_PAGES["/"].description).toMatch(/Quotes, client approval, scope checks, change orders and GST invoices for Indian freelancers/);
    const landing = readFileSync("src/routes/landing.tsx", "utf8");
    expect(landing).toContain("Get paid for every “just one small change”.</h1>");
    expect(landing).toContain("Every client job, on the record.</p>");
    expect(landing).toContain("Fresh guides for Indian freelancers every week");
    for (const f of ["src/routes/landing.tsx", "src/lib/seo-pages.ts", "src/components/site-footer.tsx", "src/routes/legal.tsx", "worker/blog.ts"]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\bScopeflow\b|GST-compliant|new posts every day|Mummidisetti/);
      expect(text, f).not.toContain("@gmail.com");
    }
  });

  it("lists plan prices in rupees in structured data, matching the catalogue", () => {
    const migration = readFileSync("supabase/migrations/20261112000000_razorpay_billing.sql", "utf8");
    for (const p of PLAN_PRICES.filter((x) => x.month > 0)) {
      expect(migration).toContain(`monthly_price_cents = ${p.month * 100}, annual_price_cents = ${p.year * 100} where id = '${p.plan.toLowerCase()}'`);
    }
    const json = JSON.stringify(structuredData("/pricing"));
    expect(json).not.toContain("USD");
    expect(json).toContain('"price":"499","priceCurrency":"INR"');
    expect(json).toContain('"price":"4999","priceCurrency":"INR"');
    expect(json).toContain('"price":"999","priceCurrency":"INR"');
    const org = (structuredData("/")["@graph"] as Record<string, unknown>[])[0];
    expect(org).toMatchObject({ email: "support@scopeflow.in", sameAs: [INSTAGRAM_URL] });
  });

  it("formats rupees the Indian way and defaults the SAC to IT design and development", () => {
    expect(formatMoney(12400000, "INR")).toBe("₹1,24,000.00");
    expect(new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(124000)).toBe(formatMoney(12400000, "INR"));
    expect(DEFAULT_SAC).toBe("998314");
  });
});

describe("sign-up source", () => {
  const now = Date.UTC(2026, 10, 3);
  it("keeps the first visit's UTM tags and outside referrer for 30 days", () => {
    const s = memory();
    expect(captureSource("https://scopeflow.in/?utm_source=instagram&utm_medium=social&utm_campaign=launch", "https://l.instagram.com/", now, s)).toMatchObject({
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "launch",
      referrer: "https://l.instagram.com/",
    });
    // A later visit doesn't overwrite the first.
    expect(captureSource("https://scopeflow.in/pricing?utm_source=google", "", now + 1000, s)).toBeNull();
    expect(readSource(now + SOURCE_TTL_MS - 1, s)?.utm_source).toBe("instagram");
    expect(readSource(now + SOURCE_TTL_MS + 1, s)).toBeNull();
    expect(s.m.size).toBe(0);
  });
  it("ignores our own pages as referrer and visits with nothing to record", () => {
    const s = memory();
    expect(captureSource("https://scopeflow.in/pricing", "https://scopeflow.in/", now, s)).toBeNull();
    expect(captureSource("https://scopeflow.in/", "", now, s)).toBeNull();
    expect(captureSource("https://scopeflow.in/blog", "https://www.google.com/", now, s)).toMatchObject({ referrer: "https://www.google.com/" });
  });
  it("hands the source over once", () => {
    const s = memory();
    captureSource(`https://scopeflow.in/?utm_source=${"x".repeat(300)}`, "", now, s);
    const t = takeSource(now, s);
    expect(t?.utm_source).toHaveLength(100);
    expect(t).not.toHaveProperty("at");
    expect(takeSource(now, s)).toBeNull();
  });
  it("works without storage", () => {
    expect(captureSource("https://scopeflow.in/?utm_source=x", "", now, null)).toBeNull();
    expect(takeSource(now, null)).toBeNull();
  });
});

describe("addresses", () => {
  it("knows every page in the route tree", () => {
    const tree = readFileSync("src/routes/tree.tsx", "utf8");
    const paths = [...tree.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");
    expect(paths.length).toBeGreaterThan(30);
    for (const p of paths) expect(isKnownPath(p.replace(/:\w+/g, "3f2b9c1e-0000-4000-8000-000000000000")), p).toBe(true);
    expect(isKnownPath("/pricing/")).toBe(true);
    for (const p of ["/nope", "/projects/a/b/c", "/blog/a/b", "/wp-admin", "/dashboard/x"]) expect(isKnownPath(p), p).toBe(false);
  });

  it("sends http and www to https://scopeflow.in with a 301, and leaves other hosts alone", () => {
    const go = (u: string) => canonicalRedirect(new Request(u));
    expect(go("http://scopeflow.in/pricing?a=1")?.status).toBe(301);
    expect(go("http://scopeflow.in/pricing?a=1")?.headers.get("location")).toBe("https://scopeflow.in/pricing?a=1");
    expect(go("https://www.scopeflow.in/blog")?.headers.get("location")).toBe("https://scopeflow.in/blog");
    expect(go("http://www.scopeflow.in/")?.headers.get("location")).toBe("https://scopeflow.in/");
    expect(go("https://scopeflow.in/pricing")).toBeNull();
    expect(go("http://localhost:3000/")).toBeNull();
    expect(go("https://scopeflow.scopeflow-8eadc7.workers.dev/")).toBeNull();
  });

  it("answers unknown pages with a real 404 and passes everything else to static assets", async () => {
    const seen: string[] = [];
    const ASSETS = {
      fetch: async (r: Request) => {
        seen.push(new URL(r.url).pathname);
        return new Response("<!doctype html><div id=root></div>", { status: 200, headers: { "content-type": "text/html" } });
      },
    };
    const env = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: "anon", ASSETS };
    const page = (p: string) => serveApp(new Request(`https://scopeflow.in${p}`, { headers: { Accept: "text/html" } }), env);
    const missing = await page("/no-such-page");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-robots-tag")).toBe("noindex");
    expect(missing.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await missing.text()).toContain('<div id=root>');
    expect((await page("/pricing")).status).toBe(200);
    expect((await page("/projects/abc/record")).status).toBe(200);
    // The mock answers every address with HTML, like the app-shell fallback: a missing file is a 404.
    expect((await page("/missing.png")).status).toBe(404);
    expect(seen).toEqual(["/__app-shell", "/pricing", "/projects/abc/record", "/missing.png"]);
  });
});
