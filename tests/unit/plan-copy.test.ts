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
