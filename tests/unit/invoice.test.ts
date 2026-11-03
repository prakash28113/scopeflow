import { describe, expect, it } from "vitest";
import { addDays, amountInWords, GSTIN, indianWords, invoiceStatus, invoiceTitle, percent, sameState, taxRows } from "@/lib/invoice";

describe("amount in words (Indian numbering)", () => {
  it("handles lakh and crore, paise, and zero", () => {
    expect(indianWords(0)).toBe("Zero");
    expect(indianWords(206)).toBe("Two Hundred Six");
    expect(indianWords(20650)).toBe("Twenty Thousand Six Hundred Fifty");
    expect(indianWords(100000)).toBe("One Lakh");
    expect(indianWords(1234567)).toBe("Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven");
    expect(indianWords(120000000)).toBe("Twelve Crore");
    expect(indianWords(1005000019)).toBe("One Hundred Crore Fifty Lakh Nineteen");
    expect(amountInWords(20650, "INR")).toBe("Rupees Two Hundred Six and Fifty Paise Only");
    expect(amountInWords(2065000, "INR")).toBe("Rupees Twenty Thousand Six Hundred Fifty Only");
    expect(amountInWords(5000, "USD")).toBeNull();
  });
});

describe("tax lines", () => {
  const base = { tax_label: "GST", tax_bps: 1800, tax_cents: 3151 };
  it("splits CGST + SGST exactly, giving the odd paisa to SGST", () => {
    expect(taxRows({ ...base, tax_split: true })).toEqual([
      { label: "CGST 9%", cents: 1575 },
      { label: "SGST 9%", cents: 1576 },
    ]);
  });
  it("shows a single line otherwise, and nothing without tax", () => {
    // GST to another state is IGST; other taxes keep their own name.
    expect(taxRows({ ...base, tax_split: false })).toEqual([{ label: "IGST 18%", cents: 3151 }]);
    expect(taxRows({ ...base, tax_label: "VAT", tax_split: false })).toEqual([{ label: "VAT 18%", cents: 3151 }]);
    expect(taxRows({ ...base, tax_bps: 0, tax_cents: 0, tax_split: false })).toEqual([]);
    expect(percent(250)).toBe("2.5");
    expect(taxRows({ tax_label: "GST", tax_bps: 500, tax_cents: 100, tax_split: true })[0].label).toBe("CGST 2.5%");
  });
  it("calls it a tax invoice only for a GST-registered seller charging tax", () => {
    expect(invoiceTitle({ seller: { name: "A", gstin: "36ABCDE1234F1Z5" }, tax_cents: 10 })).toBe("Tax invoice");
    expect(invoiceTitle({ seller: { name: "A", gstin: "36ABCDE1234F1Z5" }, tax_cents: 0 })).toBe("Invoice");
    expect(invoiceTitle({ seller: { name: "A" }, tax_cents: 10 })).toBe("Invoice");
  });
});

describe("status, GSTIN and dates", () => {
  it("works out due, overdue, paid and void", () => {
    expect(invoiceStatus({ due_date: "2026-11-10" }, false, "2026-11-01")).toBe("due");
    expect(invoiceStatus({ due_date: "2026-10-31" }, false, "2026-11-01")).toBe("overdue");
    expect(invoiceStatus({ due_date: "2026-10-31" }, true, "2026-11-01")).toBe("paid");
    expect(invoiceStatus({ due_date: null, voided_at: "2026-11-01T00:00:00Z" }, true, "2026-11-01")).toBe("void");
  });
  it("validates GSTIN and compares states", () => {
    expect(GSTIN.test("36ABCDE1234F1Z5")).toBe(true);
    expect(GSTIN.test("36abcde1234f1z5")).toBe(false);
    expect(GSTIN.test("36ABCDE1234F1Y5")).toBe(false);
    expect(sameState("36ABCDE1234F1Z5", "36AAACN1234A1Z2")).toBe(true);
    expect(sameState("36ABCDE1234F1Z5", "19AAACN1234A1Z2")).toBe(false);
    expect(sameState("36ABCDE1234F1Z5", null)).toBeNull();
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
  });
});

import { stateOf, supplyOf, stateName } from "@/lib/gst";
describe("GST place of supply", () => {
  it("reads states from the choice or the GSTIN, and picks CGST+SGST only within a state", () => {
    expect(stateOf({ gstin: "36ABCDE1234F1Z5" })).toBe("36");
    expect(stateOf({ state_code: "29", gstin: "36ABCDE1234F1Z5" })).toBe("29");
    expect(stateOf({ gstin: "99ABCDE1234F1Z5" })).toBeNull();
    expect(stateName("36")).toBe("Telangana");
    expect(supplyOf("36", "36")).toEqual({ place: "36", split: true });
    expect(supplyOf("36", "29")).toEqual({ place: "29", split: false });
    expect(supplyOf("36", null)).toEqual({ place: "36", split: true });
    expect(supplyOf(null, "29")).toEqual({ place: "29", split: false });
  });
});
