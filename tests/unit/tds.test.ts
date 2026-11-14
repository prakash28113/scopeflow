import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TDS_HELP, TDS_LABEL, paymentPayload } from "@/lib/payments";
import { parseAmount } from "@/lib/money";
import { cashReceived, projectTotals, received, tdsOf } from "@/lib/pricing";

const form = (o: Partial<{ amount: string; tds: string; date: string; method: string; reference: string }> = {}) => ({ amount: "9000", tds: "", date: "2026-11-10", method: "bank_transfer", reference: "", ...o });

describe("T-02 the Record payment form", () => {
  it("sends cash and TDS in paise", () => {
    expect(paymentPayload(form({ tds: "1000" }), "INR", 1000000, "2026-11-14", parseAmount)).toEqual({
      ok: true, cash: 900000, tds: 100000,
      payload: { amount_cents: 900000, tds_cents: 100000, paid_on: "2026-11-10", method: "bank_transfer", reference: "" },
    });
    // No TDS: the same payment as before, with tds_cents 0.
    expect(paymentPayload(form(), "INR", 1000000, "2026-11-14", parseAmount)).toMatchObject({ ok: true, payload: { amount_cents: 900000, tds_cents: 0 } });
    // TDS only, cash empty.
    expect(paymentPayload(form({ amount: "", tds: "1,000" }), "INR", 100000, "2026-11-14", parseAmount)).toMatchObject({ ok: true, payload: { amount_cents: 0, tds_cents: 100000 } });
  });
  it("refuses what the database would refuse", () => {
    const bad = (o: Parameters<typeof form>[0], due = 1000000) => paymentPayload(form(o), "INR", due, "2026-11-14", parseAmount);
    expect(bad({ amount: "9500", tds: "1000" })).toEqual({ ok: false, error: "That's more than the ₹10,000.00 still due." });
    expect(bad({ amount: "", tds: "" })).toEqual({ ok: false, error: "Enter the amount received." });
    expect(bad({ tds: "abc" })).toEqual({ ok: false, error: "Enter the TDS amount, or leave it empty." });
    expect(bad({ date: "2026-11-20" })).toMatchObject({ ok: false });
  });
  it("says it's a record only: no section numbers, rates or advice", () => {
    const strings = [TDS_LABEL, TDS_HELP, readFileSync("src/components/record-payment.tsx", "utf8").match(/Cash \{[^\n]*due/)![0]];
    expect(TDS_LABEL).toBe("TDS deducted by client (optional)");
    expect(TDS_HELP).toBe("Only if your client withheld TDS. ScopeFlow just records it; it doesn't calculate tax.");
    for (const s of strings) {
      expect(s).not.toMatch(/194|%|advice|should deduct|rate/i);
    }
    for (const file of ["src/components/record-payment.tsx", "src/components/invoice-document.tsx", "src/routes/project-detail.tsx"]) {
      const tdsLines = readFileSync(file, "utf8").split("\n").filter((l) => /TDS/.test(l));
      for (const l of tdsLines) expect(l, file).not.toMatch(/194|\d+\s*%|advice/i);
    }
  });
});

describe("T-01 cash versus settled", () => {
  const m = { amount_cents: 1000000, status: "paid", paid_cents: 1000000, tds_cents: 100000 };
  it("settled counts the TDS; cash doesn't", () => {
    expect(received(m)).toBe(1000000);
    expect(tdsOf(m)).toBe(100000);
    expect(cashReceived(m)).toBe(900000);
    expect(cashReceived({ amount_cents: 500, status: "pending", paid_cents: 200 })).toBe(200);
    expect(projectTotals(1000000, 0, [m])).toMatchObject({ contract: 1000000, paid: 1000000, cash: 900000, tds: 100000, outstanding: 0 });
  });
  it("every money-in figure uses cash, every balance uses settled", () => {
    const dash = readFileSync("src/routes/dashboard.tsx", "utf8");
    expect(dash).toContain("const collected = sumByCurrency(live.map((p) => ({ currency: p.currency, amount: p.milestones.reduce((s, m) => s + cashReceived(m), 0) })));");
    const clients = readFileSync("src/routes/clients.tsx", "utf8");
    expect(clients).toContain("formatMoney(t.cash, t.currency)");
    expect(clients).toContain("outstanding: Math.max(0, t.contracted - t.paid)");
    expect(readFileSync("src/routes/project-detail.tsx", "utf8")).toContain("{fmt(money.cash)}");
    // Analytics already sums payments.amount_cents (cash).
    expect(readFileSync("src/routes/analytics.tsx", "utf8")).toContain('supabase.from("payments").select("amount_cents, paid_on, project_id")');
    expect(readFileSync("src/components/invoice-document.tsx", "utf8")).toContain("Received {fmt(Math.max(0, paidCents - tdsCents))} + TDS deducted by client {fmt(tdsCents)}");
  });
});
