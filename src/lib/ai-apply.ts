/**
 * Turns a reviewed AI scope draft into new-project form values. The freelancer picks which parts
 * to use; the result only fills the form, which they can still edit. Nothing is saved until they
 * press "Create project", which goes through the normal checks and save_project.
 */
import type { ScopeDraft } from "./ai-schemas";

/** Parts of the draft the freelancer chose to use. */
export type DraftSelection = {
  deliverables: boolean[];
  exclusions: boolean[];
  assumptions: boolean[];
  dependencies: boolean[];
  terms: boolean;
  paymentSplit: boolean;
};

export const selectAll = (d: ScopeDraft): DraftSelection => ({
  deliverables: d.deliverables.map(() => true),
  exclusions: d.exclusions.map(() => true),
  assumptions: d.assumptions.map(() => true),
  dependencies: d.dependencies.map(() => true),
  terms: Boolean(d.terms),
  paymentSplit: d.paymentSplit.length > 0,
});

type Deliverable = {
  title: string;
  description: string;
  revisions: number | string;
  priceType: "fixed" | "hourly" | "unit";
  amount: string;
  hours: string;
  rate: string;
  quantity: string;
  unit: string;
  dueDate?: string;
};
type Milestone = { title: string; amount: string; dueDate: string };
/** The fields of the project form this touches (structurally compatible with FormValues). */
export type DraftTarget = {
  title: string;
  summary: string;
  budget: string;
  client: { name: string; email: string; company: string };
  deliverables: Deliverable[];
  milestones: Milestone[];
  exclusions: string;
  terms: string;
  extraRevision: string;
  itemised: boolean;
};

const pick = <T>(items: T[], on: boolean[]) => items.filter((_, i) => on[i] ?? true);
const amountText = (n: number | null) => (n === null ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Splits a total by percentages, in whole currency units; the last part takes the rounding. */
export function splitAmounts(total: number, percents: number[]): number[] {
  const parts = percents.map((p) => Math.floor((total * p) / 100));
  const used = parts.reduce((s, x) => s + x, 0);
  if (parts.length) parts[parts.length - 1] += Math.round(total - used);
  return parts;
}

export function draftToForm<T extends DraftTarget>(draft: ScopeDraft, sel: DraftSelection, current: T): T {
  const deliverables = pick(draft.deliverables, sel.deliverables);
  const priced = deliverables.length > 0 && deliverables.every((d) => d.amount !== null);
  const total = priced ? deliverables.reduce((s, d) => s + (d.amount ?? 0), 0) : draft.budget;

  const sections: string[] = [];
  if (sel.terms && draft.terms) sections.push(draft.terms);
  const assumptions = pick(draft.assumptions, sel.assumptions);
  if (assumptions.length) sections.push(`This quote assumes:\n${assumptions.map((a) => `- ${a}`).join("\n")}`);
  const dependencies = pick(draft.dependencies, sel.dependencies);
  if (dependencies.length) sections.push(`What we need from you:\n${dependencies.map((a) => `- ${a}`).join("\n")}`);

  const split = sel.paymentSplit && total !== null && total > 0 ? draft.paymentSplit : [];
  const amounts = splitAmounts(total ?? 0, split.map((s) => s.percent));

  return {
    ...current,
    title: draft.title,
    summary: draft.summary,
    client: current.client.name.trim() || !draft.clientName ? current.client : { ...current.client, name: draft.clientName },
    deliverables: (deliverables.length ? deliverables : draft.deliverables.slice(0, 1)).map((d) => ({
      title: d.title,
      description: d.description,
      revisions: d.revisions,
      priceType: "fixed" as const,
      amount: amountText(d.amount),
      hours: "",
      rate: "",
      quantity: "",
      unit: "",
      dueDate: "",
    })),
    itemised: priced,
    budget: priced ? current.budget : draft.budget !== null ? amountText(draft.budget) : current.budget,
    exclusions: pick(draft.exclusions, sel.exclusions).join("\n"),
    terms: sections.length ? sections.join("\n\n") : current.terms,
    extraRevision: draft.extraRevisionPrice !== null ? amountText(draft.extraRevisionPrice) : current.extraRevision,
    milestones: split.length ? split.map((s, i) => ({ title: `${s.title} (${s.percent}%)`, amount: String(amounts[i]), dueDate: "" })) : current.milestones,
  };
}
