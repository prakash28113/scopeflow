import { describe, expect, it } from "vitest";
import { buildReminders, daysBetween, type ReminderInput } from "@/lib/reminders";

const base: ReminderInput = {
  today: "2026-11-10",
  now: new Date("2026-11-10T06:00:00Z"),
  projects: [
    { id: "a", title: "Brand kit", status: "awaiting_approval", due_date: null, extra_days: 0, client: "Dana", currency: "INR" },
    { id: "b", title: "Website", status: "active", due_date: "2026-11-08", extra_days: 0, client: "Ravi", currency: "INR" },
    { id: "c", title: "Menu", status: "active", due_date: "2026-11-09", extra_days: 2, client: "Meera", currency: "USD" },
  ],
  scopeSent: [],
  changeOrders: [],
  invoices: [],
  payments: [],
  links: [],
  followUps: [],
};
const titles = (x: Partial<ReminderInput>) => buildReminders({ ...base, ...x }).map((r) => r.title);

describe("reminders", () => {
  it("counts days between dates", () => {
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("flags deadlines: past due (with extension days) and due soon", () => {
    const r = buildReminders(base);
    expect(r.map((x) => [x.tone, x.title])).toEqual([
      ["danger", "“Website” is past its deadline"],
      ["info", "“Menu” is due tomorrow"],
    ]);
  });

  it("nudges after 3 days without a client answer, not before", () => {
    expect(titles({ scopeSent: [{ project_id: "a", created_at: "2026-11-08T10:00:00Z" }] })).not.toContain("Follow up with Dana");
    expect(titles({ scopeSent: [{ project_id: "a", created_at: "2026-11-06T10:00:00Z" }] })).toContain("Follow up with Dana");
    expect(titles({ changeOrders: [{ id: "x", number: 2, title: "Extra page", created_at: "2026-11-01T10:00:00Z", project_id: "b" }] })).toContain("Change order #2 not answered");
  });

  it("flags overdue invoices with the balance, and overdue payments only when not invoiced", () => {
    const r = buildReminders({
      ...base,
      invoices: [
        { id: "i1", number: "RS-2026-001", due_date: "2026-11-05", amount_cents: 2065000, currency: "INR", project_id: "b", voided_at: null, paid: false, paid_cents: 1000000 },
        { id: "i2", number: "RS-2026-002", due_date: "2026-11-05", amount_cents: 100, currency: "INR", project_id: "b", voided_at: "2026-11-06T00:00:00Z", paid: false, paid_cents: 0 },
        { id: "i3", number: "RS-2026-003", due_date: "2026-11-05", amount_cents: 100, currency: "INR", project_id: "b", voided_at: null, paid: true, paid_cents: 100 },
      ],
      payments: [
        { id: "m1", title: "Advance", due_date: "2026-11-01", amount_cents: 5000, paid_cents: 0, status: "pending", project_id: "c", has_invoice: false },
        { id: "m2", title: "Final", due_date: "2026-11-01", amount_cents: 5000, paid_cents: 0, status: "pending", project_id: "c", has_invoice: true },
      ],
    });
    expect(r[0].title).toBe("Payment overdue: Advance"); // 9 days late sorts first
    const inv = r.find((x) => x.title === "Invoice RS-2026-001 is overdue")!;
    expect(inv.detail).toContain("₹10,650.00 due 5 days ago");
    expect(r.map((x) => x.title)).not.toContain("Invoice RS-2026-002 is overdue");
    expect(r.map((x) => x.title)).not.toContain("Invoice RS-2026-003 is overdue");
    expect(r.map((x) => x.title)).not.toContain("Payment overdue: Final");
  });

  it("warns before a client link expires while approval is pending", () => {
    expect(titles({ links: [{ project_id: "a", expires_at: "2026-11-11T12:00:00Z", revoked_at: null }] })).toContain("Client link for “Brand kit” expires in 1 day");
    expect(titles({ links: [{ project_id: "a", expires_at: "2026-11-30T12:00:00Z", revoked_at: null }] })).toHaveLength(2);
  });

  it("shows the freelancer's own follow-ups when due, not before or after done", () => {
    const r = buildReminders({
      ...base,
      followUps: [
        { id: "f1", due_on: "2026-11-10", note: "Call Dana", project_id: "a", done_at: null },
        { id: "f2", due_on: "2026-11-07", note: "Send invoice", project_id: null, done_at: null },
        { id: "f3", due_on: "2026-11-12", note: "Later", project_id: null, done_at: null },
        { id: "f4", due_on: "2026-11-01", note: "Done one", project_id: null, done_at: "2026-11-02T00:00:00Z" },
      ],
    });
    const fu = r.filter((x) => x.followUpId);
    expect(fu.map((x) => [x.title, x.detail])).toEqual([
      ["Send invoice", "Due 3 days ago"],
      ["Call Dana", "Due today · Brand kit"],
    ]);
  });
});
