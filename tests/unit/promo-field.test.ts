import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { promoSummary } from "../../src/components/promo-field";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("promo field", () => {
  it("says what the code costs, in plain words", () => {
    const t = promoSummary({ valid: true, code: "SOLO199", discount_cents: 30000, cycles: 3, price_cents: 19900, full_price_cents: 49900, currency: "INR" });
    expect(t).toContain("SOLO199");
    expect(t).toMatch(/₹199/);
    expect(t).toMatch(/first 3 months/);
    expect(t).toMatch(/₹499 a month/);
  });
  it("is only sent for Solo monthly, and cleared when the billing interval changes", () => {
    const plan = src("src/routes/plan.tsx");
    expect(plan).toContain('id === "solo" && interval === "month" && promo ? promo : undefined');
    expect(plan).toMatch(/setInterval\(v\); setPromo\(null\)/);
  });
  it("sits right above the Solo Upgrade button (not above the cards), only for a Free account on monthly billing", () => {
    expect(src("src/components/plans.tsx")).toMatch(/\{beforeBuy\?\.\(p\.id\)\}\s*<Button[\s\S]{0,300}data-upgrade/);
    const plan = src("src/routes/plan.tsx");
    expect(plan).toContain('beforeBuy={(id) => (id === "solo" && interval === "month" && effective.id === "free"');
    expect(plan).not.toMatch(/<\/div>\s*\)\s*:\s*null\}\s*<PromoField/);
  });
  it("the page never sets a price itself: amounts come from the server", () => {
    expect(src("src/components/promo-field.tsx")).not.toMatch(/\b19900\b|\b49900\b|\b199\b|\b499\b/);
  });
});
