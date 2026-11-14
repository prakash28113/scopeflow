import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PORTAL_REFERRAL_URL, changeOrderMessage, whatsAppHref } from "@/lib/client-message";

describe("ready words for a change order", () => {
  it("says what it is, what it costs, and that nothing changes until the client approves", () => {
    const m = changeOrderMessage({ clientName: "Dana Whitfield", number: 2, title: "Business cards", amountCents: 295000, currency: "INR", additionalDays: 2, businessName: "Raman Studio" });
    expect(m.text).toBe("Hi Dana, I've added change order #2 for “Business cards” on your project page: ₹2,950.00, +2 days. It's outside the scope you approved, so nothing changes until you approve it there. Thank you! – Raman Studio");
    expect(m.subject).toBe("Change order #2: Business cards (₹2,950.00)");
    expect(changeOrderMessage({ clientName: "", number: 1, title: "Extra page", amountCents: 100000, currency: "INR", additionalDays: 1 }).text).toBe("Hi there, I've added change order #1 for “Extra page” on your project page: ₹1,000.00, +1 day. It's outside the scope you approved, so nothing changes until you approve it there. Thank you!");
    expect(m.text).not.toMatch(/https?:|\/p[#?]/);
  });
  it("opens the client's own WhatsApp chat when the number is known", () => {
    expect(whatsAppHref("98765 43210", "Hi")).toBe("https://wa.me/919876543210?text=Hi");
    expect(whatsAppHref(null, "Hi there")).toBe("https://wa.me/?text=Hi%20there");
    expect(whatsAppHref("12345", "Hi")).toBe("https://wa.me/?text=Hi");
  });
  it("shows on sent change orders and in the scope link dialog", () => {
    const detail = readFileSync("src/routes/project-detail.tsx", "utf8");
    expect(detail).toContain("<TellClient");
    expect(detail).toContain("clientPhone={p.clients.phone}");
    expect(readFileSync("src/components/share-link-dialog.tsx", "utf8")).toContain("href={whatsAppHref(clientPhone, message)}");
  });
});

describe("Made with ScopeFlow on the client page", () => {
  it("links to the home page with tags that sign-up sources record", () => {
    expect(PORTAL_REFERRAL_URL).toBe("/?utm_source=client-link&utm_medium=portal");
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    expect(portal).toContain('<a href={PORTAL_REFERRAL_URL} target="_blank" rel="noopener"');
    // The client's private link is in the address fragment, which browsers never send onward.
    expect(readFileSync("src/lib/portal-link.ts", "utf8")).toContain("/p#${token}");
  });
});
