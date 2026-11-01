import { describe, expect, it } from "vitest";
import { checkScope, type ScopeCheckInput } from "@/lib/scope-check";
import { localToday, upcomingItems, whenLabel, type UpcomingProject } from "@/lib/upcoming";
import { revisionLabel } from "@/components/agreement";
import { projectFormSchema, splitLines, toProjectPayload } from "@/lib/validation";

const solid: ScopeCheckInput = {
  summary: "Logo and brand basics for a new café.",
  currency: "INR",
  budget: "45000",
  dueDate: "2026-12-01",
  deliverables: [
    { title: "Primary logo", description: "SVG, PNG and PDF; colour and mono versions", revisions: 2 },
    { title: "Business card", description: "One double-sided design, print-ready PDF", revisions: 2 },
  ],
  milestones: [{ amount: "22500" }, { amount: "22500" }],
  exclusions: "Printing\nCopywriting",
  terms: "50% advance; final files after full payment.",
  extraRevision: "1500",
};

describe("scope checker", () => {
  it("is quiet for a clear, complete scope", () => {
    expect(checkScope(solid)).toEqual([]);
  });

  it("flags open-ended wording and too many revision rounds as warnings", () => {
    const hints = checkScope({
      ...solid,
      deliverables: [
        { title: "Social media posts etc.", description: "As needed", revisions: 2 },
        { title: "Website", description: "Unlimited pages", revisions: 10 },
      ],
    });
    const warn = hints.filter((h) => h.level === "warn").map((h) => h.message);
    expect(warn.some((m) => m.includes("“Social media posts etc.”") && m.includes("etc."))).toBe(true);
    expect(warn.some((m) => m.includes("“Website”") && m.includes("unlimited"))).toBe(true);
    expect(warn.some((m) => m.includes("10 revision rounds"))).toBe(true);
    // Warnings come before tips.
    expect(hints[0].level).toBe("warn");
  });

  it("doesn't mistake ordinary words for vague ones", () => {
    const hints = checkScope({ ...solid, deliverables: [{ title: "Etching-style illustration", description: "Detailed spec attached", revisions: 2 }] });
    expect(hints.filter((h) => h.message.includes("etc."))).toEqual([]);
  });

  it("points out the missing pieces of the agreement", () => {
    const hints = checkScope({ ...solid, exclusions: " \n- \n", terms: "", extraRevision: "", dueDate: "", milestones: [] });
    const all = hints.map((h) => h.message).join(" | ");
    expect(all).toMatch(/what's not included/);
    expect(all).toMatch(/price for extra revision rounds/);
    expect(all).toMatch(/due date/);
    expect(all).toMatch(/payment terms/);
    expect(all).toMatch(/advance payment milestone/);
  });

  it("notes deliverables with no revisions or no details", () => {
    const hints = checkScope({ ...solid, deliverables: [{ title: "Logo", description: "", revisions: 0 }] });
    expect(hints.some((h) => h.message.includes("“Logo” includes no revisions"))).toBe(true);
    expect(hints.some((h) => h.message.includes("“Logo” has no details"))).toBe(true);
  });
});

describe("agreement fields", () => {
  const base = {
    title: "Logo",
    summary: "",
    currency: "INR",
    budget: "45000",
    startDate: "",
    dueDate: "",
    client: { name: "Ravi", email: "Ravi@Example.com", company: "" },
    deliverables: [{ title: "Logo", description: "", revisions: 2 }],
    milestones: [],
  };

  it("cleans exclusions into one item per line and converts the extra-round price to minor units", () => {
    const f = projectFormSchema.parse({ ...base, exclusions: "- Printing\n\n• Copywriting \n1. Hosting", terms: " 50% advance ", extraRevision: "1,500" });
    const p = toProjectPayload(f);
    expect(p.exclusions).toBe("Printing\nCopywriting\nHosting");
    expect(p.terms).toBe("50% advance");
    expect(p.extra_revision_cents).toBe(150000);
  });

  it("leaves the price empty when not given and rejects nonsense", () => {
    expect(toProjectPayload(projectFormSchema.parse({ ...base, exclusions: "", terms: "", extraRevision: "" })).extra_revision_cents).toBeNull();
    const bad = projectFormSchema.safeParse({ ...base, exclusions: "", terms: "", extraRevision: "abc" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].path).toEqual(["extraRevision"]);
  });

  it("splits list text robustly", () => {
    expect(splitLines(null)).toEqual([]);
    expect(splitLines("a\r\n* b\n  \n2) c")).toEqual(["a", "b", "c"]);
  });
});

describe("revision tracker labels", () => {
  it("shows used, remaining and extra rounds", () => {
    expect(revisionLabel(0, 2)).toBe("0 of 2 used · 2 left");
    expect(revisionLabel(2, 2)).toBe("All 2 used");
    expect(revisionLabel(3, 2)).toBe("All 2 used · 1 extra");
    expect(revisionLabel(0, 0)).toBe("No revisions included");
  });
});

describe("upcoming due dates", () => {
  const project = (over: Partial<UpcomingProject>): UpcomingProject => ({
    id: "p1",
    title: "Brand",
    currency: "INR",
    status: "active",
    due_date: null,
    extra_days: 0,
    milestones: [],
    ...over,
  });

  it("lists overdue and next-14-day items, oldest first, including change-order extra days", () => {
    const items = upcomingItems(
      [
        project({
          due_date: "2026-11-05",
          extra_days: 3,
          milestones: [
            { id: "m1", title: "Advance", amount_cents: 100, status: "pending", due_date: "2026-10-28" },
            { id: "m2", title: "Final", amount_cents: 100, status: "pending", due_date: "2026-12-30" },
            { id: "m3", title: "Paid one", amount_cents: 100, status: "paid", due_date: "2026-11-02" },
          ],
        }),
      ],
      "2026-11-01",
    );
    expect(items.map((i) => [i.label, i.date, i.daysAway])).toEqual([
      ["Advance", "2026-10-28", -4],
      ["Project due", "2026-11-08", 7],
    ]);
  });

  it("ignores payment dates the client hasn't agreed to, and finished projects' deadlines", () => {
    const items = upcomingItems(
      [
        project({ id: "draft", status: "draft", due_date: "2026-11-03", milestones: [{ amount_cents: 1, status: "pending", due_date: "2026-11-03" }] }),
        project({ id: "done", status: "completed", due_date: "2026-11-03", milestones: [{ amount_cents: 1, status: "pending", due_date: "2026-11-03" }] }),
      ],
      "2026-11-01",
    );
    expect(items.map((i) => [i.projectId, i.kind])).toEqual([["done", "payment"]]);
  });

  it("labels timing plainly and uses the viewer's local date", () => {
    expect([whenLabel(-3), whenLabel(-1), whenLabel(0), whenLabel(1), whenLabel(9)]).toEqual(["3 days overdue", "1 day overdue", "Today", "Tomorrow", "In 9 days"]);
    expect(localToday(new Date("2026-11-01T20:00:00Z"))).toMatch(/^2026-11-0[12]$/);
  });
});

import { planLimitFrom, priceLabel, type Plan } from "@/lib/plans";

describe("plan display helpers", () => {
  const solo: Plan = { id: "solo", name: "Solo", position: 2, currency: "USD", monthly_price_cents: 900, annual_price_cents: 9000, max_active_projects: null, max_clients: null, max_team_members: 1, purchasable: false };
  it("shows monthly and yearly prices with the yearly saving", () => {
    expect(priceLabel(solo, "month")).toEqual({ main: "$9.00", per: "/month", note: null });
    expect(priceLabel(solo, "year")).toEqual({ main: "$90.00", per: "/year", note: "$7.50/month · save $18.00 a year" });
    expect(priceLabel({ ...solo, id: "free", monthly_price_cents: 0, annual_price_cents: 0 }, "year").per).toBe("forever");
  });
  it("recognises the database's plan-limit error and nothing else", () => {
    const l = planLimitFrom({ code: "SF402", message: "Your Free plan includes 2 active projects…", hint: "plan_limit:active_projects", details: '{"limit":2,"used":2,"plan":"free"}' });
    expect(l).toMatchObject({ kind: "active_projects", limit: 2, used: 2, plan: "free" });
    expect(planLimitFrom({ code: "SF402", hint: "plan_limit:clients", details: "not json" })).toMatchObject({ kind: "clients", limit: 0 });
    expect(planLimitFrom({ code: "22023", message: "x" })).toBeNull();
    expect(planLimitFrom(null)).toBeNull();
  });
});
