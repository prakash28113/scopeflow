/**
 * Guards that run on every model answer, after schema validation and before the app sees it.
 * A model must never invent prices, deadlines or commitments, so:
 *  - an amount is kept only if the same number appears in what the freelancer wrote or in their
 *    own saved data (budget, prices, extra-revision price); otherwise it becomes null and the draft
 *    asks for it instead;
 *  - money written inside free text that can't be traced the same way is replaced with
 *    "[price to confirm]";
 *  - a sentence that names a calendar date the freelancer never gave is dropped.
 */

/** Numbers a person could mean in Indian or international notation: ₹40,000 · 40k · 1.5 lakh · 2 cr · 1,50,000. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s*(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(k|thousand|l|lakh|lakhs|lac|lacs|cr|crore|crores|m|mn|million)?\b/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const mult = unit === "k" || unit === "thousand" ? 1e3 : ["l", "lakh", "lakhs", "lac", "lacs"].includes(unit) ? 1e5 : ["cr", "crore", "crores"].includes(unit) ? 1e7 : ["m", "mn", "million"].includes(unit) ? 1e6 : 1;
    out.push(n * mult);
    if (mult !== 1) out.push(n);
  }
  return out;
}

export function allowedAmounts(...sources: (string | number | null | undefined)[]): Set<number> {
  const s = new Set<number>();
  for (const src of sources) {
    if (typeof src === "number" && Number.isFinite(src)) s.add(Math.round(src * 100) / 100);
    else if (typeof src === "string") for (const n of amountsIn(src)) s.add(Math.round(n * 100) / 100);
  }
  return s;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** The amount if the freelancer gave it, else null. */
export function keepAmount(value: number | null, allowed: Set<number>): number | null {
  if (value === null || value === undefined) return null;
  for (const a of allowed) if (near(a, value)) return value;
  return null;
}

const MONEY_IN_TEXT = /(?:₹|rs\.?\s?|inr\s?)\s*(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)(?:\s*(?:k|l|lakh|lakhs|cr|crore)\b)?/gi;

/** Replaces money mentions that aren't the freelancer's own numbers. */
export function scrubMoney(text: string, allowed: Set<number>): string {
  return text.replace(MONEY_IN_TEXT, (match) => {
    const n = amountsIn(match)[0];
    return n !== undefined && keepAmount(n, allowed) !== null ? match : "[price to confirm]";
  });
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_RE = new RegExp(
  `\\b(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b(?:\\s+\\d{4})?|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?)`,
  "gi",
);

export function datesIn(text: string): string[] {
  return [...text.matchAll(DATE_RE)].map((m) => m[1].toLowerCase().replace(/\s+/g, " "));
}

/** Drops sentences that state a calendar date the freelancer never mentioned. */
export function dropInventedDates(text: string, knownText: string): string {
  const known = new Set(datesIn(knownText));
  const sentences = text.split(/(?<=[.!?])\s+|\n/);
  const kept = sentences.filter((s) => datesIn(s).every((d) => known.has(d)));
  if (kept.length === sentences.length) return text;
  return kept.join(text.includes("\n") ? "\n" : " ").trim();
}

/** Both text guards at once. */
export function cleanText(text: string, allowed: Set<number>, knownText: string): string {
  return dropInventedDates(scrubMoney(text, allowed), knownText);
}
