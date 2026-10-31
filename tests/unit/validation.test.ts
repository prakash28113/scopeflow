import { describe, expect, it } from "vitest";
import { changeOrderSchema, issuesToFieldErrors, projectFormSchema, revisionRequestSchema, scopeDecisionSchema, toProjectPayload } from "@/lib/validation";

const valid = {
  title: "Website",
  summary: "",
  currency: "USD",
  budget: "2,500",
  startDate: "2026-11-01",
  dueDate: "2026-12-01",
  client: { name: "Sam", email: "Sam@Example.com", company: "" },
  deliverables: [{ title: "Homepage", description: "", revisions: "2" }],
  milestones: [{ title: "Deposit", amount: "1250", dueDate: "" }],
};

describe("project form", () => {
  it("accepts and converts a valid project", () => {
    const r = projectFormSchema.safeParse(valid);
    expect(r.success).toBe(true);
    const payload = toProjectPayload(r.data!);
    expect(payload.budget_cents).toBe(250000);
    expect(payload.client.email).toBe("sam@example.com");
    expect(payload.deliverables[0].revisions_included).toBe(2);
    expect(payload.milestones[0].amount_cents).toBe(125000);
  });
  it("reports field-level errors", () => {
    const r = projectFormSchema.safeParse({
      ...valid,
      title: " ",
      budget: "lots",
      dueDate: "2026-10-01",
      client: { name: "Sam", email: "nope", company: "" },
      deliverables: [{ title: "", description: "", revisions: "-1" }],
      milestones: [{ title: "Deposit", amount: "0", dueDate: "" }],
    });
    expect(r.success).toBe(false);
    const fe = issuesToFieldErrors(r.error!);
    expect(Object.keys(fe)).toEqual(
      expect.arrayContaining(["title", "budget", "dueDate", "client.email", "deliverables.0.title", "deliverables.0.revisions", "milestones.0.amount"]),
    );
  });
  it("requires at least one deliverable", () => {
    expect(projectFormSchema.safeParse({ ...valid, deliverables: [] }).success).toBe(false);
  });
});

describe("change order form", () => {
  const base = { title: "Extra", description: "", amount: "", hours: "", rate: "", additionalDays: "3", revisionRequestId: "" };
  it("builds an hourly payload", () => {
    const r = changeOrderSchema("USD").parse({ ...base, pricingType: "hourly", hours: "3.5", rate: "80" });
    expect(r).toMatchObject({ pricing_type: "hourly", hours: "3.50", hourly_rate_cents: 8000, additional_days: 3, amount_cents: null });
  });
  it("allows zero-price, time-only changes", () => {
    expect(changeOrderSchema("USD").parse({ ...base, pricingType: "fixed", amount: "0" }).amount_cents).toBe(0);
  });
  it("rejects bad numbers", () => {
    expect(changeOrderSchema("USD").safeParse({ ...base, pricingType: "hourly", hours: "abc", rate: "80" }).success).toBe(false);
    expect(changeOrderSchema("USD").safeParse({ ...base, pricingType: "fixed", amount: "1", additionalDays: "999" }).success).toBe(false);
    expect(changeOrderSchema("USD").safeParse({ ...base, pricingType: "fixed", amount: "1", revisionRequestId: "x" }).success).toBe(false);
  });
});

describe("client portal forms", () => {
  const id = "3f1e8b2a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  it("requires explicit confirmation to approve and a comment to reject", () => {
    expect(scopeDecisionSchema.safeParse({ snapshotId: id, decision: "approved", clientName: "Dana", comment: "" }).success).toBe(false);
    expect(scopeDecisionSchema.safeParse({ snapshotId: id, decision: "approved", clientName: "Dana", comment: "", confirm: "on" }).success).toBe(true);
    expect(scopeDecisionSchema.safeParse({ snapshotId: id, decision: "rejected", clientName: "Dana", comment: " " }).success).toBe(false);
  });
  it("requires a deliverable for revisions only", () => {
    expect(revisionRequestSchema.safeParse({ kind: "revision", deliverableId: "", description: "x", clientName: "D" }).success).toBe(false);
    expect(revisionRequestSchema.safeParse({ kind: "new_work", deliverableId: "", description: "x", clientName: "D" }).success).toBe(true);
  });
});
