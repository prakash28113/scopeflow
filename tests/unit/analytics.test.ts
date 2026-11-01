import { describe, expect, it } from "vitest";
import { change, lastMonths, monthOf, monthly, niceScale, receivables, topClients, type PaymentFact, type ReceiptFact } from "@/lib/analytics";
import { progressSummary } from "@/lib/progress";

const pay = (o: Partial<PaymentFact>): PaymentFact => ({ paid_at: null, status: "pending", amount_cents: 0, currency: "INR", due_date: null, client: "A", project: "P", project_id: "p1", ...o });

describe("months", () => {
  it("lists the last 12 months across a year boundary, oldest first", () => {
    expect(lastMonths(3, "2027-01-15")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(lastMonths(12, "2026-11-01")[0]).toBe("2025-12");
  });
  it("takes dates as written and timestamps in local time", () => {
    expect(monthOf("2026-10-31")).toBe("2026-10");
    expect(monthOf("2026-10-15T10:00:00Z")).toBe("2026-10");
  });
});

describe("monthly totals", () => {
  const months = ["2026-10", "2026-11"];
  const rows = monthly(months, "INR", {
    receipts: [
      { paid_on: "2026-10-10", amount_cents: 500000, currency: "INR", client: "A" },
      { paid_on: "2026-11-02", amount_cents: 200000, currency: "INR", client: "A" },
      { paid_on: "2026-11-30", amount_cents: 100000, currency: "INR", client: "A" }, // a part payment
      { paid_on: "2026-11-02", amount_cents: 999, currency: "USD", client: "A" },
    ],
    invoices: [
      { issue_date: "2026-11-01", amount_cents: 300000, currency: "INR", voided_at: null },
      { issue_date: "2026-11-01", amount_cents: 111111, currency: "INR", voided_at: "2026-11-01T00:00:00Z" },
    ],
    expenses: [{ spent_on: "2026-11-03", amount_cents: 50000, currency: "INR", category: "software" }],
  });
  it("counts received, invoiced (not void), expenses and profit per month, in one currency", () => {
    expect(rows).toEqual([
      { month: "2026-10", received: 500000, invoiced: 0, expenses: 0, profit: 500000 },
      { month: "2026-11", received: 300000, invoiced: 300000, expenses: 50000, profit: 250000 },
    ]);
  });
  it("compares with last month", () => {
    expect(change(300000, 500000)).toBe(-40);
    expect(change(5, 0)).toBeNull();
    expect(change(-50, -100)).toBe(50);
  });
});

describe("receivables and top clients", () => {
  const ps = [
    pay({ client: "Nova", status: "paid", amount_cents: 100, paid_cents: 100 }),
    pay({ client: "Acme", due_date: "2026-10-20", amount_cents: 1000, paid_cents: 250 }),
    pay({ client: "Nova", due_date: "2026-12-01", amount_cents: 400 }),
    pay({ client: "Zed", amount_cents: 50 }),
  ];
  const rs: ReceiptFact[] = [
    { client: "Nova", paid_on: "2026-10-01", amount_cents: 100, currency: "INR" },
    { client: "Acme", paid_on: "2026-10-01", amount_cents: 300, currency: "INR" },
    { client: "Nova", paid_on: "2026-11-01", amount_cents: 250, currency: "INR" },
    { client: "Nova", paid_on: "2025-01-01", amount_cents: 9999, currency: "INR" },
  ];
  it("totals what's still owed (part payments reduce it) and what's overdue, oldest first", () => {
    const r = receivables(ps, "INR", "2026-11-01");
    expect([r.outstanding, r.overdue, r.overdueItems.map((p) => p.client)]).toEqual([1200, 750, ["Acme"]]);
  });
  it("ranks clients by money received in the period", () => {
    expect(topClients(rs, "INR", ["2026-10", "2026-11"])).toEqual([
      { client: "Nova", cents: 350 },
      { client: "Acme", cents: 300 },
    ]);
  });
});

describe("chart scale and progress", () => {
  it("picks clean axis steps", () => {
    expect(niceScale(0)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(niceScale(160000).ticks).toEqual([0, 50000, 100000, 150000, 200000]);
    expect(niceScale(9).max).toBeGreaterThanOrEqual(9);
  });
  it("summarises deliverable progress", () => {
    expect(progressSummary([{ progress: "delivered" }, { progress: "in_progress" }, { progress: "not_started" }, {}])).toEqual({
      total: 4, delivered: 1, inProgress: 1, pct: 38, label: "1 of 4 delivered",
    });
    expect(progressSummary([]).label).toBe("No deliverables");
  });
});
