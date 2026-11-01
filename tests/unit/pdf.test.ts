import { describe, expect, it } from "vitest";
import { pageSlices, pdfFileName } from "@/lib/pdf";

describe("PDF pages", () => {
  it("ends pages at the last safe break that fills at least half the page", () => {
    expect(pageSlices(2500, 1000, [300, 900, 1200, 1700, 1990, 2500])).toEqual([[0, 900], [900, 1700], [1700, 2500]]);
  });
  it("cuts hard when no break is usable, and keeps short documents on one page", () => {
    expect(pageSlices(2100, 1000, [100])).toEqual([[0, 1000], [1000, 2000], [2000, 2100]]);
    expect(pageSlices(400, 1000, [100, 400])).toEqual([[0, 400]]);
  });
});

describe("PDF file names", () => {
  it("are safe on every system", () => {
    expect(pdfFileName("Invoice RS-2026-001")).toBe("Invoice-RS-2026-001.pdf");
    expect(pdfFileName("Café rebrand — “phase 1” / v2")).toBe("Cafe-rebrand-phase-1-v2.pdf");
    expect(pdfFileName("<<>>")).toBe("document.pdf");
  });
});
