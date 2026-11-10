/**
 * Plan wording that appears in more than one place (card, compare table, FAQ, search-engine text).
 * Keep it true to what's built: ScopeFlow doesn't send reminders to clients.
 */

/** The Free card's payments line. */
export const FREE_REMINDERS_LINE = "Payment tracking and follow-ups";

/** The Solo card, top to bottom. Every line is something Solo does today. */
export const SOLO_LINES = [
  "Unlimited active projects and clients",
  "See profit per client and per month",
  "Log expenses",
  "Download the approval record PDF",
  "Full template library",
  "Everything in Free",
] as const;

/** Under the Solo price: what it costs next to one piece of extra work. An example, not a promise. */
export const SOLO_VALUE_LINE = "One approved extra of ₹2,500 (example) pays for 5 months of Solo.";

/** Under the Solo price with the yearly toggle on. */
export const soloYearlyNote = (yearPrice: string, saved: string) => `${yearPrice}/year: 2 months free (save ${saved})`;

/** Solo in a sentence, for search engines (structured data). */
export const SOLO_OFFER_DESCRIPTION = "Unlimited active projects and clients, profit per client and per month, expense log, approval record PDF and the full template library";

const ORDINAL_ENDINGS: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
const ordinalRules = new Intl.PluralRules("en", { type: "ordinal" });
/** 3 → "3rd", 6 → "6th", 21 → "21st". */
export const ordinal = (n: number) => `${n}${ORDINAL_ENDINGS[ordinalRules.select(n)] ?? "th"}`;

/**
 * What a Free account reads when it meets a plan limit: the next one (the 3rd active project, the
 * 6th client) needs Solo, the price, and what that price is next to one piece of extra work.
 */
export function limitPrompt(kind: "active_projects" | "clients", limit: number): string {
  const next = `${ordinal(limit + 1)} ${kind === "clients" ? "client" : "active project"}`;
  return `Your ${next} needs Solo: ₹499/month. One approved extra of ₹2,500 (example) covers 5 months.`;
}
export const LIMIT_UPGRADE_LABEL = "Upgrade to Solo";
export const LIMIT_LATER_LABEL = "Not now";
