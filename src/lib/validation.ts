import { z } from "zod";
import { CURRENCIES, parseAmount } from "./money";
import { parseHours } from "./pricing";
import { lineAmount, parsePercent, quoteTotals } from "./quote";

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

export const resetRequestSchema = z.object({
  email: z.email("Enter a valid email").max(254),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use 72 characters or fewer"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match" });

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
    budget: z.string().trim(),
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
          priceType: z.enum(["fixed", "hourly"]).default("fixed"),
          amount: z.string().trim().default(""),
          hours: z.string().trim().default(""),
          rate: z.string().trim().default(""),
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
    itemised: z.boolean().default(false),
    discount: z.string().trim().default(""),
    tax: z.string().trim().default(""),
    taxLabel: optionalText(24).default(""),
    exclusions: optionalText(4000).default(""),
    terms: optionalText(4000).default(""),
    extraRevision: z.string().trim().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.itemised) {
      v.deliverables.forEach((d, i) => {
        if (d.priceType === "hourly") {
          if (parseHours(d.hours) === null) ctx.addIssue({ code: "custom", path: ["deliverables", i, "hours"], message: "Enter hours, e.g. 6 or 6.5" });
          if (parseAmount(d.rate, v.currency) === null) ctx.addIssue({ code: "custom", path: ["deliverables", i, "rate"], message: "Enter the hourly rate" });
        } else if (parseAmount(d.amount, v.currency) === null) {
          ctx.addIssue({ code: "custom", path: ["deliverables", i, "amount"], message: "Enter a price" });
        }
      });
      if (parsePercent(v.discount) === null) ctx.addIssue({ code: "custom", path: ["discount"], message: "0–100, e.g. 10" });
      if (parsePercent(v.tax) === null) ctx.addIssue({ code: "custom", path: ["tax"], message: "0–100, e.g. 18" });
    } else if (!v.budget) {
      ctx.addIssue({ code: "custom", path: ["budget"], message: "Enter the agreed budget" });
    } else if (parseAmount(v.budget, v.currency) === null) {
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

/** Price of one deliverable row in the form, or null when incomplete. */
export function formLineAmount(d: { priceType?: string; amount?: string; hours?: string; rate?: string }, currency: string): number | null {
  if (d.priceType === "hourly") {
    const h = parseHours(d.hours ?? "");
    const r = parseAmount(d.rate ?? "", currency);
    return h === null || r === null ? null : lineAmount({ type: "hourly", hoursHundredths: h, rateMinor: r });
  }
  const a = parseAmount(d.amount ?? "", currency);
  return a === null ? null : lineAmount({ type: "fixed", amountMinor: a });
}

/** Live quote totals for the form; null unless every line is priced. */
export function formQuote(f: { itemised: boolean; currency: string; discount: string; tax: string; deliverables: { priceType?: string; amount?: string; hours?: string; rate?: string }[] }) {
  if (!f.itemised) return null;
  const amounts = f.deliverables.map((d) => formLineAmount(d, f.currency));
  if (amounts.some((a) => a === null)) return null;
  return quoteTotals(amounts as number[], parsePercent(f.discount) ?? 0, parsePercent(f.tax) ?? 0);
}

/** Converts validated form values into the save_project() payload. */
export function toProjectPayload(f: ProjectForm) {
  const quote = formQuote(f);
  return {
    title: f.title,
    summary: f.summary,
    currency: f.currency,
    // With an itemised quote the database computes the budget; this value is only a fallback.
    budget_cents: quote ? quote.total : parseAmount(f.budget, f.currency)!,
    discount_bps: f.itemised ? parsePercent(f.discount) || null : null,
    tax_bps: f.itemised ? parsePercent(f.tax) || null : null,
    tax_label: f.itemised ? f.taxLabel : "",
    start_date: f.startDate,
    due_date: f.dueDate,
    client: { name: f.client.name, email: f.client.email.toLowerCase(), company: f.client.company },
    deliverables: f.deliverables.map((d) => ({
      title: d.title,
      description: d.description,
      revisions_included: d.revisions,
      ...(f.itemised
        ? d.priceType === "hourly"
          ? { pricing_type: "hourly", hours: (parseHours(d.hours)! / 100).toFixed(2), rate_cents: parseAmount(d.rate, f.currency) }
          : { pricing_type: "fixed", amount_cents: parseAmount(d.amount, f.currency) }
        : {}),
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

// ---------------------------------------------------------------- clients
export const clientSchema = z.object({
  name: text(120, "Client name"),
  company: optionalText(120),
  phone: optionalText(40).refine((v) => v === "" || /^[+()\d\s.-]{5,40}$/.test(v), "Use digits, spaces and + ( ) - only"),
  notes: optionalText(4000),
});
