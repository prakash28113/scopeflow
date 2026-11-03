import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { anyOnSale, planSale } from "@/lib/sale";
import { contractUnpaid, invoiceBalance, OUTSTANDING_LABEL, scheduledDue } from "@/lib/outstanding";
import { APP_TIME_ZONE, formatDate, formatDateTime, formatTime, formatToday } from "@/lib/format";
import { guessCurrency } from "@/lib/money";
import { paymentTax, taxInside } from "@/lib/pricing";
import { placeRuns } from "@/lib/pdf";
import { clearOnAccountChange } from "@/lib/auth";
import { HOME_FAQ, PRICING_FAQ } from "@/lib/faq";
import { structuredData } from "@/lib/seo-pages";
import { serveApp } from "../../worker/index";

describe("is a plan on sale (one answer for every screen)", () => {
  const solo = { id: "solo", purchasable: true };
  const studio = { id: "studio", purchasable: false };
  it("billing off: nothing is on sale or buyable, whatever the catalogue says", () => {
    expect(planSale(solo, false)).toEqual({ onSale: false, buyable: false, testMode: false });
    expect(planSale(solo, false, { enabled: true, mode: "live", tester: false })).toMatchObject({ onSale: false, buyable: false });
    expect(anyOnSale([solo, studio], false)).toBe(false);
  });
  it("billing on and purchasable: on sale and buyable; not purchasable: neither", () => {
    expect(planSale(solo, true).onSale).toBe(true); // signed out: public claim only
    expect(planSale(solo, true, { enabled: true, mode: "live", tester: false })).toEqual({ onSale: true, buyable: true, testMode: false });
    expect(planSale(studio, true, { enabled: true, mode: "live", tester: false })).toEqual({ onSale: false, buyable: false, testMode: false });
    expect(anyOnSale([solo, studio], true)).toBe(true);
  });
  it("the billing check failing or saying off wins over the catalogue; test mode is for testers only", () => {
    expect(planSale(solo, true, { enabled: false, mode: null, tester: false })).toEqual({ onSale: false, buyable: false, testMode: false });
    expect(planSale(studio, true, { enabled: true, mode: "test", tester: true })).toEqual({ onSale: false, buyable: true, testMode: true });
    expect(planSale(solo, true, { enabled: true, mode: "test", tester: false })).toEqual({ onSale: false, buyable: false, testMode: false });
    expect(planSale({ id: "free", purchasable: true }, true).onSale).toBe(false);
  });
});

describe("what's still owed (one definition per label)", () => {
  // Contract ₹42,480 (₹36,580 quote + ₹5,900 change order). Scheduled: ₹20,000 paid, ₹5,900 part-paid ₹2,000.
  const project = {
    budget_cents: 3658000,
    approved_extras_cents: 590000,
    milestones: [
      { amount_cents: 2000000, status: "paid" },
      { amount_cents: 590000, status: "pending", paid_cents: 200000 },
    ],
  };
  it("contract unpaid, scheduled & due and invoice balance", () => {
    expect(contractUnpaid(project)).toBe(4248000 - 2200000);
    expect(scheduledDue(project.milestones)).toBe(390000);
    expect(invoiceBalance([{ amount_cents: 590000, milestones: project.milestones[1] }, { amount_cents: 590000, voided_at: "2026-11-03T00:00:00Z", milestones: null }])).toBe(390000);
    expect(contractUnpaid({ ...project, milestones: [{ amount_cents: 5000000, status: "paid" }] })).toBe(0); // never negative
    expect(Object.values(OUTSTANDING_LABEL)).toEqual(["Contract unpaid", "Scheduled & due", "Balance due"]);
  });
  it("screens use the shared labels, not a bare 'Outstanding'", () => {
    for (const f of ["src/routes/dashboard.tsx", "src/routes/analytics.tsx", "src/routes/clients.tsx", "src/routes/project-detail.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/>Outstanding<|label="Outstanding"/);
    }
  });
});

describe("dates and times in India time", () => {
  // 18:40 UTC on 2 Nov = 00:10 IST on 3 Nov: a device in California still says 2 Nov.
  const late = "2026-11-02T18:40:00Z";
  it("moments default to Asia/Kolkata", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Kolkata");
    expect(formatDate(late)).toBe("Nov 3, 2026");
    expect(formatDate(late, "America/Los_Angeles")).toBe("Nov 2, 2026");
    expect(formatDateTime(late)).toMatch(/Nov 3, 2026, 12:10\sAM GMT\+5:30/);
    expect(formatTime(late)).toMatch(/12:10\sAM/);
    expect(formatToday(new Date(late))).toBe("Tuesday, 3 November");
  });
  it("calendar dates (due dates, invoice dates) are shown as written", () => {
    expect(formatDate("2026-11-03")).toBe("Nov 3, 2026");
  });
});

describe("onboarding currency", () => {
  it("guesses INR for India and for unknown zones", () => {
    expect(guessCurrency("", "Asia/Kolkata")).toBe("INR");
    expect(guessCurrency("", "Asia/Calcutta")).toBe("INR");
    expect(guessCurrency("", "America/Los_Angeles")).toBe("USD");
    expect(guessCurrency("", "Mars/Olympus")).toBe("INR");
    expect(guessCurrency("", "")).toBe("INR");
  });
});

describe("GST on payment lines", () => {
  const cos = [{ id: "co1", amount_cents: 590000, tax_cents: 90000, tax_label: "GST" }];
  it("change-order payments show the change order's GST; quote payments the quote's", () => {
    expect(paymentTax({ amount_cents: 590000, change_order_id: "co1" }, { tax_bps: 1800 }, cos)).toEqual({ label: "GST", cents: 90000 });
    expect(paymentTax({ amount_cents: 2065000, change_order_id: null }, { tax_bps: 1800, tax_label: "GST" }, cos)).toEqual({ label: "GST", cents: 315000 });
    expect(paymentTax({ amount_cents: 2065000 }, { tax_bps: 0 }, cos)).toBeNull();
    expect(taxInside(20650, 1800)).toBe(3150);
  });
});

describe("PDF text layer", () => {
  it("puts each line on its page, in points, baseline inside the line", () => {
    const runs = [
      { x: 0, top: 10, height: 20, size: 16, text: "INV-2026-27-001" },
      { x: 100, top: 1200, height: 20, size: 13, text: "Total ₹41,300.00" },
    ];
    const placed = placeRuns(runs, [[0, 1000], [1000, 2000]], 0.5, 36);
    expect(placed).toEqual([
      { page: 0, x: 36, y: 36 + (10 + 16) * 0.5, size: 8, text: "INV-2026-27-001" },
      { page: 1, x: 86, y: 36 + (200 + 16) * 0.5, size: 6.5, text: "Total ₹41,300.00" },
    ]);
  });
  it("ships a font with the rupee sign for the text layer", () => {
    const ttf = readFileSync("public/fonts/pdf-text.ttf");
    expect(ttf.length).toBeLessThan(80_000);
    expect(readFileSync("public/fonts/pdf-text-LICENSE.txt", "utf8")).toMatch(/Bitstream|DejaVu/);
  });
});

describe("signing out", () => {
  it("clears every cached query, so the next account never sees the last one's data", () => {
    const qc = new QueryClient();
    qc.setQueryData(["profile"], { full_name: "Bhagi QA Test", business_name: "Bhagi QA Studio" });
    clearOnAccountChange("TOKEN_REFRESHED", qc);
    expect(qc.getQueryData(["profile"])).toBeDefined();
    clearOnAccountChange("SIGNED_OUT", qc);
    expect(qc.getQueryData(["profile"])).toBeUndefined();
    qc.setQueryData(["profile"], { full_name: "A" });
    clearOnAccountChange("SIGNED_IN", qc);
    expect(qc.getQueryData(["profile"])).toBeUndefined();
  });
});

describe("public copy", () => {
  it("the FAQ matches the plans (no free analytics claim), in the page and its structured data", () => {
    const all = JSON.stringify([HOME_FAQ, PRICING_FAQ, structuredData("/"), structuredData("/pricing")]);
    expect(all).not.toContain("free for everyone during the beta");
    expect(all).toContain("Analytics, expenses and the approval record PDF are on Solo (₹499/month)");
    expect(all).not.toMatch(/Payments for paid plans are handled by Razorpay/);
  });
  it("one shared header with the full wordmark on every public page", () => {
    for (const f of ["src/routes/landing.tsx", "src/routes/pricing.tsx", "src/routes/legal.tsx", "src/routes/blog.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("<PublicHeader");
    }
    const header = readFileSync("src/components/public-header.tsx", "utf8");
    expect(header).toContain('<LogoFull tone={dark ? "white" : "color"} className="h-5 w-auto min-[360px]:h-[22px] sm:h-8" />');
    expect(header).not.toContain("LogoMark");
    expect(header).toContain('href="/#product"');
  });
});

describe("files", () => {
  const ASSET_HEADERS = { "content-type": "text/javascript", "cache-control": "public, max-age=31536000, immutable" };
  const ASSETS = {
    fetch: async (r: Request) => {
      const path = new URL(r.url).pathname;
      if (path === "/assets/index-abc123.js") return new Response("console.log(1)", { headers: ASSET_HEADERS });
      if (path === "/favicon.ico") return new Response("ico", { headers: { "content-type": "image/x-icon" } });
      // Static assets answer a miss with the app shell (single-page-application handling), cached like an asset.
      return new Response("<!doctype html><div id=root></div>", { headers: { "content-type": "text/html", "cache-control": "public, max-age=31536000, immutable" } });
    },
  };
  const env = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: "anon", ASSETS };
  const get = (p: string) => serveApp(new Request(`https://scopeflow.in${p}`), env);
  it("a missing /assets/ file is a 404 that isn't cached, a real one keeps its long cache", async () => {
    const miss = await get("/assets/nope.js");
    expect(miss.status).toBe(404);
    expect(miss.headers.get("cache-control")).toBe("no-store");
    expect(miss.headers.get("content-type")).not.toContain("text/html");
    const hit = await get("/assets/index-abc123.js");
    expect(hit.status).toBe(200);
    expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await get("/favicon.ico")).headers.get("content-type")).toBe("image/x-icon");
  });
  it("the Worker runs for /assets/ too, and favicon.ico exists", () => {
    const cfg = readFileSync("wrangler.jsonc", "utf8");
    expect(cfg).toContain('"run_worker_first": ["/*"]');
    expect(readFileSync("public/favicon.ico").subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });
});
