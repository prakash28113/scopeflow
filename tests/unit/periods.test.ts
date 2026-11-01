import { describe, expect, it } from "vitest";
import { customPeriod, financialYears, fyQuarters, monthPeriod, periodTotals, projectProfits, topClientsIn, within } from "@/lib/analytics";

describe("periods", () => {
  it("months, including the previous month across a year end", () => {
    expect(monthPeriod("2026-02")).toMatchObject({ from: "2026-02-01", to: "2026-02-28", prev: { from: "2026-01-01", to: "2026-01-31" } });
    expect(monthPeriod("2026-01").prev).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(monthPeriod("2028-02").to).toBe("2028-02-29");
  });

  it("Indian financial-year quarters, newest first", () => {
    const q = fyQuarters("2026-11-01", 6);
    expect(q.map((p) => [p.key, p.from, p.to])).toEqual([
      ["2026-Q3", "2026-10-01", "2026-12-31"],
      ["2026-Q2", "2026-07-01", "2026-09-30"],
      ["2026-Q1", "2026-04-01", "2026-06-30"],
      ["2025-Q4", "2026-01-01", "2026-03-31"],
      ["2025-Q3", "2025-10-01", "2025-12-31"],
      ["2025-Q2", "2025-07-01", "2025-09-30"],
    ]);
    expect(q[0].label).toBe("Q3 FY 2026–27 (Oct–Dec 2026)");
    expect(q[3].label).toBe("Q4 FY 2025–26 (Jan–Mar 2026)");
    expect(q[3].prev).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(fyQuarters("2026-02-10", 1)[0]).toMatchObject({ key: "2025-Q4", from: "2026-01-01" });
  });

  it("financial years run April to March", () => {
    expect(financialYears("2026-03-31", 2).map((p) => [p.label, p.from, p.to])).toEqual([
      ["FY 2025–26", "2025-04-01", "2026-03-31"],
      ["FY 2024–25", "2024-04-01", "2025-03-31"],
    ]);
    expect(financialYears("2026-04-01", 1)[0].label).toBe("FY 2026–27");
  });

  it("custom ranges compare with the same number of days before", () => {
    expect(customPeriod("2026-10-10", "2026-10-19")).toMatchObject({ prev: { from: "2026-09-30", to: "2026-10-09" }, prevLabel: "previous 10 days" });
    expect(customPeriod("2026-10-19", "2026-10-10")).toBeNull();
    expect(customPeriod("", "2026-10-10")).toBeNull();
  });

  it("dates are inclusive at both ends", () => {
    const r = { from: "2026-10-01", to: "2026-10-31" };
    expect(within("2026-10-01", r) && within("2026-10-31", r)).toBe(true);
    expect(within("2026-11-01", r)).toBe(false);
  });
});

describe("period totals and clients", () => {
  const receipts = [
    { paid_on: "2026-04-01", amount_cents: 100, currency: "INR", client: "A", project_id: "p1" },
    { paid_on: "2026-06-30", amount_cents: 200, currency: "INR", client: "B", project_id: "p2" },
    { paid_on: "2026-07-01", amount_cents: 400, currency: "INR", client: "A", project_id: "p1" },
    { paid_on: "2026-05-01", amount_cents: 999, currency: "USD", client: "C", project_id: "p3" },
  ];
  const invoices = [
    { issue_date: "2026-05-05", amount_cents: 300, currency: "INR", voided_at: null },
    { issue_date: "2026-05-06", amount_cents: 300, currency: "INR", voided_at: "2026-05-07T00:00:00Z" },
  ];
  const expenses = [{ spent_on: "2026-05-10", amount_cents: 50, currency: "INR", category: "software" }];
  const q1 = { from: "2026-04-01", to: "2026-06-30" };

  it("adds up a quarter in one currency, ignoring void invoices", () => {
    expect(periodTotals(q1, "INR", { receipts, invoices, expenses })).toEqual({ received: 300, invoiced: 300, expenses: 50, profit: 250 });
  });

  it("ranks clients within the period", () => {
    expect(topClientsIn(receipts, "INR", q1)).toEqual([{ client: "B", cents: 200 }, { client: "A", cents: 100 }]);
  });
});

describe("profit by project", () => {
  it("received minus linked expenses, with margin, highest first", () => {
    const rows = projectProfits(
      [
        { id: "p1", title: "Logo", client: "A", status: "completed", currency: "INR", approved_at: "2026-04-01", contract: 1000 },
        { id: "p2", title: "Site", client: "B", status: "active", currency: "INR", approved_at: "2026-04-02", contract: 5000 },
        { id: "p3", title: "Draft only", client: "C", status: "draft", currency: "INR", approved_at: null, contract: 100 },
        { id: "p4", title: "Cancelled", client: "D", status: "cancelled", currency: "INR", approved_at: "2026-04-03", contract: 100 },
        { id: "p5", title: "Dollars", client: "E", status: "active", currency: "USD", approved_at: "2026-04-03", contract: 100 },
      ],
      [{ project_id: "p1", amount_cents: 1000 }, { project_id: "p2", amount_cents: 500 }],
      [
        { project_id: "p1", amount_cents: 250, currency: "INR" },
        { project_id: "p2", amount_cents: 800, currency: "INR" },
        { project_id: null, amount_cents: 999, currency: "INR" },
      ],
      "INR",
    );
    expect(rows.map((r) => [r.id, r.received, r.expenses, r.profit, r.margin])).toEqual([
      ["p1", 1000, 250, 750, 75],
      ["p2", 500, 800, -300, -60],
    ]);
  });
});
