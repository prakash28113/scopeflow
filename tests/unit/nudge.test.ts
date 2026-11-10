import { describe, expect, it } from "vitest";
import { buildNudge, canNudge, dayMonth, mailLink, waLink, waNumber } from "@/lib/nudge";

const base = { clientName: "Dana Whitfield", invoiceNumber: "INV-2026-27-014", balanceCents: 1032500, currency: "INR", dueDate: "2026-11-07", today: "2026-11-10", upiId: "priya@okhdfc", businessName: "Raman Studio" } as const;

describe("N-01 the nudge message", () => {
  it("gentle, not yet due or due today", () => {
    expect(buildNudge({ ...base, tone: "gentle", dueDate: "2026-11-12" }).text).toBe("Hi Dana, a quick reminder: invoice INV-2026-27-014 for ₹10,325.00 is due on 12 Nov. You can pay by UPI to priya@okhdfc. Thank you! – Raman Studio");
    expect(buildNudge({ ...base, tone: "gentle", dueDate: "2026-11-10" }).text).toContain("is due on 10 Nov");
  });
  it("gentle, overdue", () => {
    expect(buildNudge({ ...base, tone: "gentle" }).text).toBe("Hi Dana, a quick reminder: invoice INV-2026-27-014 for ₹10,325.00 was due on 7 Nov. You can pay by UPI to priya@okhdfc. Thank you! – Raman Studio");
  });
  it("firm, overdue, with the days counted", () => {
    expect(buildNudge({ ...base, tone: "firm" }).text).toBe("Hi Dana, invoice INV-2026-27-014 for ₹10,325.00 was due on 7 Nov and is now 3 days overdue. Please pay by UPI to priya@okhdfc or let me know when to expect it. Thanks, Raman Studio");
    expect(buildNudge({ ...base, tone: "firm", today: "2026-11-08" }).text).toContain("is now 1 day overdue");
    // Firm before the due date falls back to the gentle wording (the button is disabled anyway).
    expect(buildNudge({ ...base, tone: "firm", dueDate: "2026-11-20" }).text).toContain("a quick reminder");
  });
  it("uses the balance still owed, with Indian grouping", () => {
    const partPaid = buildNudge({ ...base, tone: "gentle", balanceCents: 1032500 - 500000 });
    expect(partPaid.text).toContain("for ₹5,325.00 ");
    expect(partPaid.text).not.toContain("10,325");
    expect(partPaid.subject).toBe("Reminder: invoice INV-2026-27-014 (₹5,325.00)");
    expect(buildNudge({ ...base, tone: "gentle", balanceCents: 12345600 }).text).toContain("₹1,23,456.00");
  });
  it("drops the UPI sentence and the sign-off name when they're empty", () => {
    expect(buildNudge({ ...base, tone: "gentle", upiId: "", businessName: null }).text).toBe("Hi Dana, a quick reminder: invoice INV-2026-27-014 for ₹10,325.00 was due on 7 Nov. Thank you!");
    expect(buildNudge({ ...base, tone: "firm", upiId: null, businessName: " " }).text).toBe("Hi Dana, invoice INV-2026-27-014 for ₹10,325.00 was due on 7 Nov and is now 3 days overdue. Please let me know when to expect it. Thanks.");
    expect(buildNudge({ ...base, tone: "gentle", clientName: "  " }).text).toMatch(/^Hi there,/);
  });
  it("never contains a link, the client portal path or a token", () => {
    for (const tone of ["gentle", "firm"] as const) {
      const { text, subject } = buildNudge({ ...base, tone });
      for (const s of [text, subject]) {
        expect(s).not.toMatch(/https?:|www\.|\/p[?#/]|token|scopeflow\.in/i);
        expect(s).not.toMatch(/[\r\n]/);
      }
    }
    expect(dayMonth("2026-01-03")).toBe("3 Jan");
  });
});

describe("N-01 WhatsApp and email links", () => {
  it("normalises phone numbers", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("09876543210")).toBe("919876543210");
    expect(waNumber("+91 98765-43210")).toBe("919876543210");
    expect(waNumber("+44 7700 900123")).toBe("447700900123");
    expect(waNumber("(040) 2345 6789")).toBeNull(); // a landline without a country code
    expect(waNumber("12345")).toBeNull();
    expect(waNumber("")).toBeNull();
    expect(waNumber(null)).toBeNull();
    expect(waNumber("+1 234 567 890 123 4567")).toBeNull();
  });
  it("builds wa.me and mailto links with the text encoded", () => {
    const { text, subject } = buildNudge({ ...base, tone: "gentle" });
    const wa = waLink("98765 43210", text)!;
    expect(wa.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(decodeURIComponent(wa.split("?text=")[1])).toBe(text);
    expect(waLink("12345", text)).toBeNull();
    const mail = mailLink("dana@northwind.example", subject, text);
    expect(mail).toBe(`mailto:dana%40northwind.example?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`);
    // The only "http" anywhere is the wa.me wrapper itself.
    expect(wa.replace("https://wa.me/", "")).not.toMatch(/http/i);
    expect(mail).not.toMatch(/http/i);
    expect(wa + mail).not.toContain("%2Fp%3F");
  });
});

describe("N-02 when the Nudge button shows", () => {
  const inv = (due: string | null, voided = false) => ({ due_date: due, voided_at: voided ? "2026-11-01T00:00:00Z" : null });
  it("from 3 days before the due date, and always when overdue", () => {
    expect(canNudge(inv("2026-11-14"), false, 1000, "2026-11-10")).toBe(false);
    expect(canNudge(inv("2026-11-13"), false, 1000, "2026-11-10")).toBe(true);
    expect(canNudge(inv("2026-11-10"), false, 1000, "2026-11-10")).toBe(true);
    expect(canNudge(inv("2026-09-01"), false, 1000, "2026-11-10")).toBe(true);
  });
  it("never for a voided, paid, fully settled or undated invoice", () => {
    expect(canNudge(inv("2026-11-01", true), false, 1000, "2026-11-10")).toBe(false);
    expect(canNudge(inv("2026-11-01"), true, 0, "2026-11-10")).toBe(false);
    expect(canNudge(inv("2026-11-01"), false, 0, "2026-11-10")).toBe(false);
    expect(canNudge(inv(null), false, 1000, "2026-11-10")).toBe(false);
  });
});
