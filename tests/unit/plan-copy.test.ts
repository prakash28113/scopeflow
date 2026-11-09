import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { FREE_REMINDERS_LINE } from "@/lib/plan-copy";
import { FeatureMatrix, HIGHLIGHTS, PlanCards, ROWS } from "@/components/plans";
import { HOME_FAQ, PRICING_FAQ } from "@/lib/faq";
import { PUBLIC_PAGES, structuredData } from "@/lib/seo-pages";
import type { Plan } from "@/lib/plans";

const plan = (id: Plan["id"], name: string, m: number, y: number): Plan =>
  ({ id, name, position: 0, currency: "INR", monthly_price_cents: m, annual_price_cents: y, max_active_projects: id === "free" ? 2 : null, max_clients: id === "free" ? 5 : null, max_team_members: id === "studio" ? 3 : 1, purchasable: id === "solo" }) as Plan;
export const PLANS = [plan("free", "Free", 0, 0), plan("solo", "Solo", 49900, 499900), plan("studio", "Studio", 99900, 999900)];
const html = (el: React.ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el)).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const card = (id: string, interval: "month" | "year" = "month") => {
  const all = html(createElement(PlanCards, { plans: PLANS, interval }));
  const from = all.indexOf(`data-plan="${id}"`);
  const next = all.indexOf("data-plan=", from + 10);
  return all.slice(from, next === -1 ? undefined : next);
};
const lines = (cardHtml: string) => [...cardHtml.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("T2-01 the Free card doesn't promise reminders to clients", () => {
  it("uses the decided line", () => {
    expect(FREE_REMINDERS_LINE).toBe("Payment tracking and follow-ups");
    expect(lines(card("free"))).toEqual(["2 active projects", "5 clients", "Scope agreements, approvals, revision tracking", "Change orders, quotes and GST invoices", "Payment tracking and follow-ups"]);
  });
  it("no public plan copy says 'reminder'", () => {
    const pricing = JSON.stringify(structuredData("/pricing")) + JSON.stringify(PUBLIC_PAGES["/pricing"]) + JSON.stringify(structuredData("/")) + JSON.stringify(PUBLIC_PAGES["/"]);
    const copy = [
      ...Object.values(HIGHLIGHTS).flat(),
      ...ROWS.map((r) => r.label),
      ...PRICING_FAQ.flat(),
      ...HOME_FAQ.flat().filter((t) => /plan|free|solo|price|₹/i.test(t)),
      html(createElement(PlanCards, { plans: PLANS, interval: "month" })),
      html(createElement(FeatureMatrix, { plans: PLANS })),
      pricing,
    ].join("\n");
    expect(copy).not.toMatch(/reminder/i);
    expect(copy).toContain(FREE_REMINDERS_LINE);
  });
});

import { SOLO_LINES, SOLO_OFFER_DESCRIPTION, SOLO_VALUE_LINE } from "@/lib/plan-copy";
import { PLAN_PRICES } from "@/lib/seo-pages";
import { TEMPLATES } from "@/lib/templates";

describe("T2-05 the Solo card", () => {
  it("lists these lines, in this order, and says 'Unlimited' once", () => {
    expect(lines(card("solo"))).toEqual([
      "Unlimited active projects and clients",
      "See profit per client and per month",
      "Log expenses",
      "Download the approval record PDF",
      "Full template library",
      "Everything in Free",
    ]);
    expect([...SOLO_LINES]).toEqual(lines(card("solo")));
    expect(card("solo").match(/Unlimited/g)).toHaveLength(1);
    expect(card("solo", "year").match(/Unlimited/g)).toHaveLength(1);
  });
  it("only lists what exists: Solo unlocks templates beyond the starter set", () => {
    expect(TEMPLATES.some((t) => !t.starter)).toBe(true);
    expect(TEMPLATES.some((t) => t.starter)).toBe(true);
  });
  it("puts the price in terms of one extra, and the yearly saving when the toggle is on", () => {
    expect(SOLO_VALUE_LINE).toBe("One approved extra of ₹2,500 (example) pays for 5 months of Solo.");
    expect(Math.floor(2500 / 499)).toBe(5);
    const monthly = card("solo");
    expect(monthly).toContain(SOLO_VALUE_LINE);
    expect(monthly).not.toContain("2 months free");
    const yearly = card("solo", "year");
    expect(yearly).toContain("₹4,999/year: 2 months free (save ₹989)");
    expect(yearly).toContain(SOLO_VALUE_LINE);
    // Free and Studio are as they were.
    expect(lines(card("studio"))).toEqual(["Unlimited active projects", "Unlimited clients", "Everything in Solo", "Up to 3 team members — coming", "White-label client portal — coming"]);
    expect(card("studio", "year")).toContain("save ₹1,989 a year");
  });
  it("structured data describes Solo the same way, with the same prices", () => {
    expect(PLAN_PRICES).toEqual([
      { plan: "Free", month: 0, year: 0, description: "2 active projects and 5 clients" },
      { plan: "Solo", month: 499, year: 4999, description: SOLO_OFFER_DESCRIPTION },
      { plan: "Studio", month: 999, year: 9999, description: "Everything in Solo, for small studios" },
    ]);
    const offers = JSON.stringify(structuredData("/pricing"));
    for (const price of ['"price":"0"', '"price":"499"', '"price":"4999"', '"price":"999"', '"price":"9999"']) expect(offers).toContain(price);
    expect(offers).toContain(SOLO_OFFER_DESCRIPTION);
    expect(SOLO_OFFER_DESCRIPTION.match(/Unlimited/g)).toHaveLength(1);
  });
});
