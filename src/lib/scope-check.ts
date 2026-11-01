/**
 * Scope checker: plain rules (no AI, nothing leaves the browser) that flag the
 * wording and gaps that most often lead to scope arguments.
 */
import { parseAmount } from "./money";
import { splitLines } from "./validation";

export type ScopeHint = { level: "warn" | "tip"; message: string };

export type ScopeCheckInput = {
  summary: string;
  currency: string;
  budget: string;
  dueDate: string;
  deliverables: { title: string; description: string; revisions: number | string; dueDate?: string }[];
  startDate?: string;
  milestones: { amount: string }[];
  exclusions: string;
  terms: string;
  extraRevision: string;
};

/** Phrases that leave the amount of work open-ended. */
const VAGUE: [RegExp, string][] = [
  [/\betc\b\.?/i, "etc."],
  [/\band (so on|more)\b/i, "and so on / and more"],
  [/\bunlimited\b/i, "unlimited"],
  [/\bas (needed|required|necessary)\b/i, "as needed"],
  [/\b(any|all) (changes|revisions|edits)\b/i, "any/all changes"],
  [/\bmisc(ellaneous)?\b/i, "miscellaneous"],
  [/\bvarious\b/i, "various"],
  [/\bwhatever\b/i, "whatever"],
  [/\btbd\b|\bto be decided\b/i, "TBD"],
  [/\bnot limited to\b/i, "not limited to"],
];

function vagueTerm(text: string): string | null {
  for (const [re, label] of VAGUE) if (re.test(text)) return label;
  return null;
}

export function checkScope(v: ScopeCheckInput): ScopeHint[] {
  const hints: ScopeHint[] = [];
  const named = v.deliverables.map((d, i) => ({ ...d, name: d.title.trim() ? `“${d.title.trim()}”` : `Deliverable ${i + 1}` }));

  for (const d of named) {
    const term = vagueTerm(`${d.title} ${d.description}`);
    if (term) hints.push({ level: "warn", message: `${d.name} says “${term}”. Spell out exactly what's included so it can't grow.` });
  }
  const summaryTerm = vagueTerm(v.summary);
  if (summaryTerm) hints.push({ level: "warn", message: `The summary says “${summaryTerm}”. Clients may read it as a promise of extra work.` });

  for (const d of named) {
    const n = Number(d.revisions);
    if (!Number.isFinite(n)) continue;
    if (n > 5) hints.push({ level: "warn", message: `${d.name} allows ${n} revision rounds. Two or three is typical; more invites endless tweaks.` });
  }
  const zero = named.filter((d) => Number(d.revisions) === 0);
  if (zero.length) hints.push({ level: "tip", message: `${zero.map((d) => d.name).join(", ")} ${zero.length === 1 ? "includes" : "include"} no revisions, so every change request will be out of scope. Intended?` });

  if (!splitLines(v.exclusions).length) {
    hints.push({ level: "warn", message: "Add what's not included (for example copywriting, stock photos, printing). Clear exclusions prevent most scope disputes." });
  }
  if (!v.extraRevision.trim()) {
    hints.push({ level: "tip", message: "Set a price for extra revision rounds so the client knows the cost before asking." });
  }

  const undescribed = named.filter((d) => d.title.trim() && !d.description.trim());
  if (undescribed.length) {
    hints.push({
      level: "tip",
      message:
        undescribed.length === 1
          ? `${undescribed[0].name} has no details. Add formats, sizes, pages or quantities.`
          : `${undescribed.length} deliverables have no details. Add formats, sizes, pages or quantities.`,
    });
  }
  if (!v.dueDate) hints.push({ level: "tip", message: "Add a due date so the timeline is part of what the client approves." });
  for (const d of named) {
    if (d.dueDate && v.dueDate && d.dueDate > v.dueDate)
      hints.push({ level: "warn", message: `${d.name} is due after the project's due date. Move it earlier, or the project date later.` });
    if (d.dueDate && v.startDate && d.dueDate < v.startDate)
      hints.push({ level: "warn", message: `${d.name} is due before the project starts.` });
  }
  if (!v.terms.trim()) hints.push({ level: "tip", message: "Add payment terms, for example “50% advance, final files after full payment”." });

  const budget = parseAmount(v.budget, v.currency);
  if (budget && budget > 0 && v.milestones.length === 0) {
    hints.push({ level: "tip", message: "Add an advance payment milestone so work starts with money in hand." });
  }

  return hints.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
}
