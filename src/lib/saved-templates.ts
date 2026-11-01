/**
 * The freelancer's own templates (public.scope_templates): a scope saved from the project form
 * and applied to a new one. Stored as form text, so applying it fills the form exactly as it was.
 * Anything unexpected in stored data is dropped rather than trusted (tested in tests/unit/saved-templates.test.ts).
 */
import { z } from "zod";
import { CURRENCIES } from "./money";

const str = (max: number) => z.string().max(max).catch("");
const deliverable = z.object({
  title: str(160),
  description: str(2000),
  revisions: z.coerce.number().int().min(0).max(50).catch(1),
  priceType: z.enum(["fixed", "hourly", "unit"]).catch("fixed"),
  amount: str(20),
  hours: str(12),
  rate: str(20),
  quantity: str(12),
  unit: str(24),
});

export const templateData = z.object({
  v: z.literal(1).catch(1),
  currency: z.enum(CURRENCIES).optional().catch(undefined),
  summary: str(4000),
  deliverables: z.array(deliverable).min(1).max(50),
  exclusions: str(4000),
  terms: str(4000),
  extraRevision: str(20),
  itemised: z.boolean().catch(false),
  discount: str(8),
  tax: str(8),
  taxLabel: str(24),
});
export type TemplateData = z.infer<typeof templateData>;

type FormLike = {
  currency: string;
  summary: string;
  deliverables: { title: string; description: string; revisions: number | string; priceType: string; amount: string; hours: string; rate: string; quantity: string; unit: string }[];
  exclusions: string;
  terms: string;
  extraRevision: string;
  itemised: boolean;
  discount: string;
  tax: string;
  taxLabel: string;
};

/** What gets saved: the reusable parts of a scope. Never the client, dates or milestones. */
export function toTemplateData(f: FormLike): TemplateData {
  return templateData.parse({
    v: 1,
    currency: f.currency,
    summary: f.summary,
    deliverables: f.deliverables.map((d) => ({
      title: d.title,
      description: d.description,
      revisions: d.revisions,
      priceType: d.priceType,
      amount: d.amount,
      hours: d.hours,
      rate: d.rate,
      quantity: d.quantity,
      unit: d.unit,
    })),
    exclusions: f.exclusions,
    terms: f.terms,
    extraRevision: f.extraRevision,
    itemised: f.itemised,
    discount: f.discount,
    tax: f.tax,
    taxLabel: f.taxLabel,
  });
}

/** Stored data → form values, or null if it isn't a usable template. */
export function fromTemplateData(data: unknown): TemplateData | null {
  const r = templateData.safeParse(data);
  return r.success ? r.data : null;
}
