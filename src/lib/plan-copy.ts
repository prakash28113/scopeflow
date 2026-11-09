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
