import { z } from "zod";
import { CURRENCIES, parseAmount } from "./money";
import { parseHours } from "./pricing";

export type FieldErrors = Record<string, string>;

export type ActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  message?: string;
};

export function issuesToFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date")
  .refine((v) => v === "" || !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Use a valid date");

const text = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max} characters or fewer`);
const optionalText = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer`);

// ---------------------------------------------------------------- auth
export const signUpSchema = z.object({
  fullName: text(120, "Name"),
  email: z.email("Enter a valid email").max(254),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use 72 characters or fewer"),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export const onboardingSchema = z.object({
  fullName: text(120, "Name"),
  businessName: optionalText(120),
  currency: z.enum(CURRENCIES, "Choose a currency"),
});

// ---------------------------------------------------------------- projects
export const projectFormSchema = z
  .object({
    title: text(160, "Project title"),
    summary: optionalText(4000),
    currency: z.enum(CURRENCIES, "Choose a currency"),
    budget: z.string().trim().min(1, "Enter the agreed budget"),
    startDate: optionalDate,
    dueDate: optionalDate,
    client: z.object({
      name: text(120, "Client name"),
      email: z.email("Enter a valid client email").max(254),
      company: optionalText(120),
    }),
    deliverables: z
      .array(
        z.object({
          title: text(160, "Deliverable title"),
          description: optionalText(2000),
          revisions: z.coerce
            .number("Enter a number")
            .int("Use a whole number")
            .min(0, "Cannot be negative")
            .max(50, "Maximum is 50"),
        }),
      )
      .min(1, "Add at least one deliverable")
      .max(50, "Up to 50 deliverables"),
    milestones: z
      .array(
        z.object({
          title: text(200, "Milestone title"),
          amount: z.string().trim().min(1, "Enter an amount"),
          dueDate: optionalDate,
        }),
      )
      .max(50, "Up to 50 milestones"),
    exclusions: optionalText(4000).default(""),
    terms: optionalText(4000).default(""),
    extraRevision: z.string().trim().default(""),
  })
  .superRefine((v, ctx) => {
    if (parseAmount(v.budget, v.currency) === null) {
      ctx.addIssue({ code: "custom", path: ["budget"], message: "Enter a valid amount, e.g. 2500 or 2500.00" });
    }
    if (v.extraRevision && parseAmount(v.extraRevision, v.currency) === null) {
      ctx.addIssue({ code: "custom", path: ["extraRevision"], message: "Enter a valid amount, or leave it empty" });
    }
    v.milestones.forEach((m, i) => {
      const a = parseAmount(m.amount, v.currency);
      if (a === null || a <= 0) {
        ctx.addIssue({ code: "custom", path: ["milestones", i, "amount"], message: "Enter an amount above zero" });
      }
    });
    if (v.startDate && v.dueDate && v.dueDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date must be after the start date" });
    }
  });

export type ProjectForm = z.infer<typeof projectFormSchema>;

/** Converts validated form values into the save_project() payload. */
export function toProjectPayload(f: ProjectForm) {
  return {
    title: f.title,
    summary: f.summary,
    currency: f.currency,
    budget_cents: parseAmount(f.budget, f.currency)!,
    start_date: f.startDate,
    due_date: f.dueDate,
    client: { name: f.client.name, email: f.client.email.toLowerCase(), company: f.client.company },
    deliverables: f.deliverables.map((d) => ({
      title: d.title,
      description: d.description,
      revisions_included: d.revisions,
    })),
    milestones: f.milestones.map((m) => ({
      title: m.title,
      amount_cents: parseAmount(m.amount, f.currency)!,
      due_date: m.dueDate,
    })),
    exclusions: cleanLines(f.exclusions),
    terms: f.terms,
    extra_revision_cents: f.extraRevision ? parseAmount(f.extraRevision, f.currency) : null,
  };
}

/** One item per line, blank lines and list bullets removed. */
export function cleanLines(s: string) {
  return splitLines(s).join("\n");
}

export function splitLines(s: string | null | undefined): string[] {
  return String(s ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- change orders
export function changeOrderSchema(currency: string) {
  return z
    .object({
      title: text(160, "Title"),
      description: optionalText(4000),
      pricingType: z.enum(["fixed", "hourly"]),
      amount: z.string().trim(),
      hours: z.string().trim(),
      rate: z.string().trim(),
      additionalDays: z.coerce.number("Enter a number").int("Use whole days").min(0).max(365, "Maximum is 365 days"),
      revisionRequestId: z.union([z.uuid(), z.literal("")]),
    })
    .superRefine((v, ctx) => {
      if (v.pricingType === "fixed") {
        if (parseAmount(v.amount, currency) === null) {
          ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter a valid price (0 for time-only changes)" });
        }
      } else {
        if (parseHours(v.hours) === null) {
          ctx.addIssue({ code: "custom", path: ["hours"], message: "Enter hours, up to two decimals" });
        }
        if (parseAmount(v.rate, currency) === null) {
          ctx.addIssue({ code: "custom", path: ["rate"], message: "Enter a valid hourly rate" });
        }
      }
    })
    .transform((v) => {
      const hundredths = v.pricingType === "hourly" ? parseHours(v.hours)! : null;
      return {
        title: v.title,
        description: v.description,
        pricing_type: v.pricingType,
        amount_cents: v.pricingType === "fixed" ? parseAmount(v.amount, currency)! : null,
        hours: hundredths === null ? null : (hundredths / 100).toFixed(2),
        hourly_rate_cents: v.pricingType === "hourly" ? parseAmount(v.rate, currency)! : null,
        additional_days: v.additionalDays,
        revision_request_id: v.revisionRequestId || null,
      };
    });
}

// ---------------------------------------------------------------- client portal
export const scopeDecisionSchema = z
  .object({
    snapshotId: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
    clientName: text(120, "Your name"),
    comment: optionalText(4000),
    confirm: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "rejected" && !v.comment) {
      ctx.addIssue({ code: "custom", path: ["comment"], message: "Tell your freelancer what needs to change" });
    }
    if (v.decision === "approved" && v.confirm !== "on") {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "Please confirm you approve this scope" });
    }
  });

export const revisionRequestSchema = z
  .object({
    kind: z.enum(["revision", "new_work"]),
    deliverableId: z.union([z.uuid(), z.literal("")]),
    description: text(4000, "Description"),
    clientName: text(120, "Your name"),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "revision" && !v.deliverableId) {
      ctx.addIssue({ code: "custom", path: ["deliverableId"], message: "Choose the deliverable to revise" });
    }
  });

export const changeOrderDecisionSchema = z.object({
  changeOrderId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  clientName: text(120, "Your name"),
  comment: optionalText(4000),
});
