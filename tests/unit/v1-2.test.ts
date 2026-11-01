import { describe, expect, it } from "vitest";
import { applyBps, bpsToPercent, parsePercent, quoteTotals } from "@/lib/quote";
import { TEMPLATES } from "@/lib/templates";
import { clientSchema, formQuote, projectFormSchema, toProjectPayload } from "@/lib/validation";
import { pricingFrom } from "@/components/quote";

describe("quote maths", () => {
  it("rounds half away from zero at each step, discount before tax", () => {
    expect(applyBps(1001, 5000)).toBe(501); // 500.5 → 501
    expect(applyBps(999, 5000)).toBe(500); // 499.5 → 500
    expect(quoteTotals([3280000], 1000, 1800)).toEqual({ subtotal: 3280000, discount: 328000, tax: 531360, total: 3483360 });
    expect(quoteTotals([333], 0, 1800)).toEqual({ subtotal: 333, discount: 0, tax: 60, total: 393 }); // 59.94 → 60
  });
  it("parses percentages to basis points", () => {
    expect([parsePercent(""), parsePercent("18"), parsePercent("12.5"), parsePercent("100")]).toEqual([0, 1800, 1250, 10000]);
    expect([parsePercent("100.01"), parsePercent("-1"), parsePercent("abc"), parsePercent("1.234")]).toEqual([null, null, null, null]);
    expect([bpsToPercent(1800), bpsToPercent(1250), bpsToPercent(null)]).toEqual(["18", "12.5", ""]);
  });
});

describe("itemised project form", () => {
  const base = {
    title: "Menu", summary: "", currency: "INR", budget: "", startDate: "", dueDate: "",
    client: { name: "Ravi", email: "ravi@example.com", company: "" }, milestones: [],
    exclusions: "", terms: "", extraRevision: "", itemised: true, discount: "10", tax: "18", taxLabel: "GST",
    deliverables: [
      { title: "Logo", description: "", revisions: 2, priceType: "fixed", amount: "25000", hours: "", rate: "" },
      { title: "Social", description: "", revisions: 1, priceType: "hourly", amount: "", hours: "6.5", rate: "1200" },
    ],
  };
  it("computes the live total and sends line items, discount and tax", () => {
    const f = projectFormSchema.parse(base);
    expect(formQuote(f)).toEqual({ subtotal: 3280000, discount: 328000, tax: 531360, total: 3483360 });
    const p = toProjectPayload(f);
    expect(p.budget_cents).toBe(3483360);
    expect([p.discount_bps, p.tax_bps, p.tax_label]).toEqual([1000, 1800, "GST"]);
    expect(p.deliverables).toEqual([
      { title: "Logo", description: "", revisions_included: 2, pricing_type: "fixed", amount_cents: 2500000, due_date: null },
      { title: "Social", description: "", revisions_included: 1, pricing_type: "hourly", hours: "6.50", rate_cents: 120000, due_date: null },
    ]);
  });
  it("doesn't need a budget when itemised, but needs every price", () => {
    const bad = projectFormSchema.safeParse({ ...base, deliverables: [{ ...base.deliverables[0], amount: "" }] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path.join("."))).toContain("deliverables.0.amount");
    const notItemised = projectFormSchema.safeParse({ ...base, itemised: false });
    expect(notItemised.error?.issues.map((i) => i.path.join("."))).toEqual(["budget"]);
  });
  it("matches the totals shown from saved deliverables", () => {
    const lines = [{ title: "a", pricing_type: "fixed" as const, amount_cents: 2500000 }, { title: "b", pricing_type: "hourly" as const, hours: "6.50", rate_cents: 120000, amount_cents: 780000 }];
    expect(pricingFrom(lines, 1000, 1800, "GST")?.total_cents).toBe(3483360);
    expect(pricingFrom([{ title: "x" }], 0, 0, null)).toBeNull();
  });
});

describe("templates and client profiles", () => {
  it("has six templates, three of them starter, each complete", () => {
    expect(TEMPLATES).toHaveLength(6);
    expect(TEMPLATES.filter((t) => t.starter).map((t) => t.id)).toEqual(["graphic-design", "brand-identity", "web-development"]);
    for (const t of TEMPLATES) {
      expect(t.deliverables.length, t.id).toBeGreaterThan(0);
      expect(t.exclusions.length, t.id).toBeGreaterThan(1);
      expect(t.terms.length, t.id).toBeGreaterThan(20);
      for (const d of t.deliverables) expect(d.revisions).toBeLessThanOrEqual(5);
    }
  });
  it("validates client phone numbers", () => {
    expect(clientSchema.safeParse({ name: "A", company: "", phone: "+91 98765-43210", notes: "" }).success).toBe(true);
    expect(clientSchema.safeParse({ name: "A", company: "", phone: "call me", notes: "" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: " ", company: "", phone: "", notes: "" }).success).toBe(false);
  });
});
