import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { formatMoney, minorDigits, parseAmount, toInputAmount } from "@/lib/money";
import { addDays, changeOrderAmount, currentDueDate, hourlyAmount, increasePercent, parseHours, projectTotals } from "@/lib/pricing";

describe("money", () => {
  it("parses amounts without floating point error", () => {
    expect(parseAmount("1250.5", "USD")).toBe(125050);
    expect(parseAmount("1,250.05", "USD")).toBe(125005);
    expect(parseAmount("0.1", "USD")).toBe(10);
    expect(parseAmount("19.99", "EUR")).toBe(1999);
    expect(parseAmount("5000", "JPY")).toBe(5000);
  });
  it("rejects malformed amounts", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "12.", ".5"]) expect(parseAmount(bad, "USD")).toBeNull();
    expect(parseAmount("10.5", "JPY")).toBeNull();
  });
  it("round-trips input values", () => {
    expect(toInputAmount(125005, "USD")).toBe("1250.05");
    expect(toInputAmount(5, "USD")).toBe("0.05");
    expect(toInputAmount(5000, "JPY")).toBe("5000");
    expect(parseAmount(toInputAmount(987654321, "INR"), "INR")).toBe(987654321);
  });
  it("formats by currency", () => {
    expect(minorDigits("JPY")).toBe(0);
    expect(formatMoney(125050, "USD")).toBe("$1,250.50");
    expect(formatMoney(5000, "JPY")).toBe("¥5,000");
  });
});

describe("pricing", () => {
  it("parses hours to hundredths", () => {
    expect(parseHours("3.25")).toBe(325);
    expect(parseHours("2")).toBe(200);
    expect(parseHours("0")).toBeNull();
    expect(parseHours("1.234")).toBeNull();
    expect(parseHours("10001")).toBeNull();
  });
  it("computes hourly and fixed change orders", () => {
    expect(changeOrderAmount({ type: "hourly", hoursHundredths: 325, rateMinor: 8500 })).toBe(27625);
    expect(changeOrderAmount({ type: "fixed", amountMinor: 20000 })).toBe(20000);
    expect(hourlyAmount(1, 50)).toBe(1); // 0.5 rounds half-up
    expect(hourlyAmount(1, 49)).toBe(0);
  });
  it("matches PostgreSQL round(hours * rate) exactly", async () => {
    const db = new PGlite();
    const cases: [number, number][] = [];
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let i = 0; i < 400; i++) cases.push([rand(100000) + 1, rand(5_000_000)]);
    cases.push([1, 50], [1, 150], [15, 3333], [999999, 99999999]);
    const values = cases.map(([h, r]) => `((${h} / 100.0)::numeric(8,2), ${r}::bigint)`).join(",");
    const res = await db.query<{ amount: string | number }>(
      `select round(h * r)::bigint as amount from (values ${values}) as t(h, r)`,
    );
    res.rows.forEach((row, i) => expect(hourlyAmount(cases[i][0], cases[i][1])).toBe(Number(row.amount)));
  });
  it("extends the timeline", () => {
    expect(addDays("2026-11-30", 4)).toBe("2026-12-04");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(currentDueDate(null, 5)).toBeNull();
    expect(currentDueDate("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("totals contract, paid and outstanding", () => {
    const t = projectTotals(300000, 27625, [
      { amount_cents: 150000, status: "paid" },
      { amount_cents: 150000, status: "pending" },
      { amount_cents: 27625, status: "pending" },
    ]);
    expect(t).toEqual({ original: 300000, extras: 27625, contract: 327625, scheduled: 327625, paid: 150000, cash: 150000, tds: 0, outstanding: 177625, unscheduled: 0 });
    expect(increasePercent(300000, 27625)).toBe(9.2);
    expect(increasePercent(0, 100)).toBeNull();
  });
});

import { withTax } from "@/lib/pricing";
import { formatPrice } from "@/lib/plans";
import { financialYear } from "@/lib/format";
describe("Indian money formatting and GST maths", () => {
  it("groups rupees in lakh and crore, other currencies in thousands", () => {
    expect(formatMoney(12400000, "INR")).toBe("₹1,24,000.00");
    expect(formatMoney(1234567800, "INR")).toBe("₹1,23,45,678.00");
    expect(formatMoney(12400050, "INR")).toBe("₹1,24,000.50");
    expect(formatMoney(12400000, "USD")).toBe("$124,000.00");
    expect(formatPrice(49900, "INR")).toBe("₹499");
    expect(formatPrice(9900000, "INR")).toContain("99,000");
  });
  it("adds GST to a change order price, rounded to the paisa", () => {
    expect(withTax(1750000, 1800)).toEqual({ subtotal: 1750000, tax: 315000, total: 2065000 });
    expect(withTax(333, 1800).total).toBe(393);
    expect(withTax(1000, 0).total).toBe(1000);
  });
  it("names the Indian financial year (April to March)", () => {
    // Midnight India time on 1 April starts the new year, even though it's still 31 March in UTC.
    expect(financialYear(new Date("2026-03-31T18:30:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2026-03-31T18:29:00Z"))).toBe("2025-26");
    expect(financialYear(new Date("2027-03-31T12:00:00Z"))).toBe("2026-27");
  });
});
