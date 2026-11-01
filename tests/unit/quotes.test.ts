import { describe, expect, it } from "vitest";
import { formLineAmount, formQuote, parseQuantity, projectFormSchema, toProjectPayload } from "@/lib/validation";
import { quoteExpired } from "@/lib/quote";
import { lineBasis } from "@/components/quote";
import { fromTemplateData, toTemplateData } from "@/lib/saved-templates";

const base = {
  title: "Social media", summary: "", currency: "INR", budget: "", startDate: "", dueDate: "",
  client: { name: "Dana", email: "Dana@Example.com", company: "" }, milestones: [], itemised: true,
  discount: "10", tax: "18", taxLabel: "GST", exclusions: "", terms: "", extraRevision: "", validUntil: "",
};
const unitLine = { title: "Posts", description: "", revisions: 1, priceType: "unit", amount: "", hours: "", rate: "500", quantity: "10", unit: "posts", dueDate: "" };

describe("quantity × unit price", () => {
  it("parses quantities and prices lines like the database (half up)", () => {
    expect(parseQuantity("10")).toBe(1000);
    expect(parseQuantity("2.5")).toBe(250);
    for (const bad of ["0", "-1", "1.234", "abc", "", "100001"]) expect(parseQuantity(bad)).toBeNull();
    expect(formLineAmount({ priceType: "unit", quantity: "10", rate: "500" }, "INR")).toBe(500000);
    expect(formLineAmount({ priceType: "unit", quantity: "2.5", rate: "3.33" }, "INR")).toBe(833);
    expect(formLineAmount({ priceType: "unit", quantity: "", rate: "500" }, "INR")).toBeNull();
  });

  it("validates, totals and sends per-unit lines with the rest of the quote", () => {
    const f = projectFormSchema.parse({ ...base, deliverables: [unitLine, { ...unitLine, title: "Logo", priceType: "fixed", amount: "25000" }] });
    expect(formQuote(f)).toEqual({ subtotal: 3000000, discount: 300000, tax: 486000, total: 3186000 });
    expect(toProjectPayload(f).deliverables[0]).toMatchObject({ pricing_type: "unit", quantity: "10.00", rate_cents: 50000, unit_label: "posts" });
    const bad = projectFormSchema.safeParse({ ...base, deliverables: [{ ...unitLine, quantity: "ten", rate: "" }] });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path.join("."))).toEqual(["deliverables.0.quantity", "deliverables.0.rate"]);
  });

  it("explains each priced line", () => {
    expect(lineBasis({ title: "Posts", pricing_type: "unit", quantity: "10.00", unit_label: "posts", rate_cents: 50000 }, "INR")).toBe("10 posts × ₹500.00");
    expect(lineBasis({ title: "Reels", pricing_type: "unit", quantity: 2.5, rate_cents: 100 }, "USD")).toBe("2.5 × $1.00");
    expect(lineBasis({ title: "Edits", pricing_type: "hourly", hours: "6.50", rate_cents: 120000 }, "INR")).toBe("6.5 h × ₹1,200.00");
    expect(lineBasis({ title: "Logo", pricing_type: "fixed", amount_cents: 100 }, "INR")).toBeNull();
  });
});

describe("quote validity", () => {
  it("is optional, can't be in the past when saving, and is sent", () => {
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const ok = projectFormSchema.parse({ ...base, validUntil: iso(today), deliverables: [unitLine] });
    expect(toProjectPayload(ok).valid_until).toBe(iso(today));
    expect(toProjectPayload(projectFormSchema.parse({ ...base, deliverables: [unitLine] })).valid_until).toBeNull();
    const past = projectFormSchema.safeParse({ ...base, validUntil: "2020-01-01", deliverables: [unitLine] });
    expect(past.error!.issues[0]).toMatchObject({ path: ["validUntil"], message: "Choose today or a later date" });
  });

  it("stays open through its last day everywhere on Earth, like the database", () => {
    // 20 Nov at 11:00 UTC: it's still 19 Nov at UTC−12, so a quote valid until the 19th is open.
    const now = new Date("2026-11-20T11:00:00Z");
    expect(quoteExpired("2026-11-19", now)).toBe(false);
    expect(quoteExpired("2026-11-19", new Date("2026-11-20T12:00:00Z"))).toBe(true);
    expect(quoteExpired("2026-11-25", now)).toBe(false);
    expect(quoteExpired(null, now)).toBe(false);
  });
});

describe("saved templates", () => {
  it("round-trips the reusable parts of a scope, never the client or dates", () => {
    const values = { ...base, deliverables: [{ ...unitLine, dueDate: "2026-12-01" }] };
    const data = toTemplateData(values);
    expect(data).not.toHaveProperty("client");
    expect(data.deliverables[0]).not.toHaveProperty("dueDate");
    expect(fromTemplateData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it("drops unexpected or broken stored data instead of trusting it", () => {
    expect(fromTemplateData({ deliverables: [] })).toBeNull();
    expect(fromTemplateData("nope")).toBeNull();
    const odd = fromTemplateData({ deliverables: [{ title: "X", revisions: 999, priceType: "free", extra: "<script>" }], currency: "XYZ", itemised: "yes" });
    expect(odd).toMatchObject({ currency: undefined, itemised: false, deliverables: [{ title: "X", revisions: 1, priceType: "fixed", amount: "" }] });
    expect(odd!.deliverables[0]).not.toHaveProperty("extra");
  });
});
