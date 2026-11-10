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

import { LIMIT_LATER_LABEL, LIMIT_UPGRADE_LABEL, limitPrompt, ordinal } from "@/lib/plan-copy";
import { PlanLimitCard } from "@/components/plans";
import { isRepeat, rememberCheckoutSource, takeCheckoutSource } from "@/lib/usage";

describe("T2-11 the limit prompt gives the price, the reason and a way to upgrade", () => {
  it("names the next project or client and what Solo costs", () => {
    expect(limitPrompt("active_projects", 2)).toBe("Your 3rd active project needs Solo: ₹499/month. One approved extra of ₹2,500 (example) covers 5 months.");
    expect(limitPrompt("clients", 5)).toBe("Your 6th client needs Solo: ₹499/month. One approved extra of ₹2,500 (example) covers 5 months.");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
  });
  it("the card: Upgrade to Solo goes to the plan page with Solo chosen; Not now leaves", () => {
    for (const kind of ["active_projects", "clients"] as const) {
      const out = html(createElement(PlanLimitCard, { limit: { kind, limit: kind === "clients" ? 5 : 2, used: kind === "clients" ? 5 : 2, plan: "free", message: "m" } }));
      expect(out).toContain(limitPrompt(kind, kind === "clients" ? 5 : 2));
      expect(out).toMatch(/<a[^>]*href="\/plan\?plan=solo&interval=monthly"[^>]*>Upgrade to Solo<\/a>/);
      expect(out).toMatch(/<a[^>]*href="\/dashboard"[^>]*>Not now<\/a>/);
      expect(out).not.toContain("See plans");
    }
    expect([LIMIT_UPGRADE_LABEL, LIMIT_LATER_LABEL]).toEqual(["Upgrade to Solo", "Not now"]);
  });
  it("remembers where Upgrade was pressed, for one checkout", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(takeCheckoutSource(store)).toBe("plan");
    rememberCheckoutSource("limit", store);
    expect(takeCheckoutSource(store)).toBe("limit");
    expect(takeCheckoutSource(store)).toBe("plan");
    rememberCheckoutSource("pricing", store);
    expect(takeCheckoutSource(store)).toBe("pricing");
    expect(takeCheckoutSource(null)).toBe("plan");
  });
  it("counts a limit once even if the card renders again straight away", () => {
    const seen = new Map<string, number>();
    expect(isRepeat("limit_hit:clients", 1000, seen)).toBe(false);
    expect(isRepeat("limit_hit:clients", 30_000, seen)).toBe(true);
    expect(isRepeat("limit_hit:active_projects", 30_000, seen)).toBe(false);
    expect(isRepeat("limit_hit:clients", 62_000, seen)).toBe(false);
  });
});
