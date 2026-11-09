import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { BUSINESS_GSTIN, PRICE_TAX_NOTE, businessGstinLine } from "@/lib/business";
import { checkoutOptions } from "@/lib/checkout-options";
import { FeatureMatrix, PlanCards } from "@/components/plans";
import { PRICING_FAQ } from "@/lib/faq";
import type { Plan } from "@/lib/plans";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const plan = (id: Plan["id"], name: string, m: number, y: number, extra: Partial<Plan> = {}): Plan =>
  ({ id, name, position: 0, currency: "INR", monthly_price_cents: m, annual_price_cents: y, max_active_projects: id === "free" ? 2 : null, max_clients: id === "free" ? 5 : null, max_team_members: 1, purchasable: id === "solo", ...extra }) as Plan;
const PLANS = [plan("free", "Free", 0, 0), plan("solo", "Solo", 49900, 499900), plan("studio", "Studio", 99900, 999900)];
const html = (el: React.ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el)).replace(/&#x27;/g, "'");

describe("T1-03 the GST note is shown wherever Solo is priced", () => {
  it("is the decided sentence, and there is no GSTIN", () => {
    expect(PRICE_TAX_NOTE).toBe("₹499/month. No GST is charged: ScopeFlow isn't GST-registered.");
    expect(BUSINESS_GSTIN).toBe("");
    expect(businessGstinLine()).toBeNull();
    expect(businessGstinLine("36ABCDE1234F1Z5")).toBe("GSTIN 36ABCDE1234F1Z5");
  });
  it("pricing: under the Solo price only, and in the compare table's footer", () => {
    const cards = html(createElement(PlanCards, { plans: PLANS, interval: "month" }));
    expect(cards.split(PRICE_TAX_NOTE).length - 1).toBe(1);
    const solo = cards.slice(cards.indexOf('data-plan="solo"'), cards.indexOf('data-plan="studio"'));
    expect(solo).toContain(PRICE_TAX_NOTE);
    expect(solo).toContain("₹499");
    expect(html(createElement(FeatureMatrix, { plans: PLANS }))).toContain(`Solo: ${PRICE_TAX_NOTE}`);
  });
  it("Plan & usage: next to the Upgrade button", () => {
    const cards = html(createElement(PlanCards, { plans: PLANS, interval: "year", current: "free", canBuy: (p: Plan) => p.id === "solo", onBuy: () => {}, onJoin: () => {} }));
    const solo = cards.slice(cards.indexOf('data-plan="solo"'), cards.indexOf('data-plan="studio"'));
    expect(solo).toContain("Upgrade to Solo");
    expect(solo).toContain(PRICE_TAX_NOTE);
    expect(src("src/routes/plan.tsx")).toContain("Solo: ${PRICE_TAX_NOTE}");
  });
  it("Razorpay's window gets the note as text; the subscription and key are passed through untouched", () => {
    const c = { key_id: "rzp_live_abc", subscription_id: "sub_123", mode: "live", plan_name: "Solo", interval: "month", amount_cents: 49900, currency: "INR", email: "a@b.in", name: "Asha" } as const;
    const o = checkoutOptions(c, "https://scopeflow.in") as Record<string, unknown>;
    expect(o.description).toBe(`Solo plan, billed monthly. ${PRICE_TAX_NOTE}`);
    expect(o.key).toBe("rzp_live_abc");
    expect(o.subscription_id).toBe("sub_123");
    // A subscription checkout carries no amount or plan of its own: Razorpay reads both from the subscription.
    expect(Object.keys(o).sort()).toEqual(["description", "image", "key", "name", "prefill", "subscription_id", "theme"]);
    expect(checkoutOptions({ ...c, interval: "year", mode: "test" }, "https://x").description).toBe(`Solo plan, billed yearly (test mode). ${PRICE_TAX_NOTE}`);
  });
  it("the server side of checkout is untouched by this item", () => {
    const h = src("supabase/functions/billing/handler.ts");
    expect(h).not.toContain("GST");
    expect(h).not.toContain("business");
  });
  it("Terms and the pricing FAQ carry a prices-and-tax sentence", () => {
    expect(src("src/routes/legal.tsx")).toContain("<strong>Prices and tax:</strong> Solo is {PRICE_TAX_NOTE}");
    const faq = PRICING_FAQ.find(([q]) => q === "Do prices include GST?");
    expect(faq?.[1]).toContain(PRICE_TAX_NOTE);
  });
  it("ScopeFlow's own GSTIN shows in the footer, Contact and Terms only when there is one", () => {
    expect(src("src/components/site-footer.tsx")).toContain('{businessGstinLine() ? <p data-testid="business-gstin">{businessGstinLine()}</p> : null}');
    const legal = src("src/routes/legal.tsx");
    expect(legal.match(/GSTIN_LINE \? /g)?.length).toBe(2); // Terms and Contact
  });
});
