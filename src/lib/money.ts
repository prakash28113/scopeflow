/**
 * Money is stored as integer minor units (cents, paise, yen...). Parsing is
 * string-based so no floating-point rounding ever touches an amount.
 */
export const CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "CAD", "AUD", "NZD", "SGD", "AED", "CHF", "SEK", "NOK", "DKK",
  "JPY", "ZAR", "BRL", "MXN", "PHP", "IDR", "MYR", "NGN", "KES", "PKR", "BDT", "LKR",
] as const;

export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** "1,250.5" -> 125050 (USD). Returns null for anything that isn't a clean amount. */
export function parseAmount(input: string, currency: string): number | null {
  const cleaned = input.replace(/[\s,]/g, "");
  const digits = minorDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const minor = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 125050 -> "1250.50" — for prefilling inputs. */
export function toInputAmount(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const s = String(Math.abs(minor)).padStart(digits + 1, "0");
  return `${minor < 0 ? "-" : ""}${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/** Rupees use Indian digit grouping (₹1,24,000); other currencies the international style. */
export const moneyLocale = (currency: string) => (currency === "INR" ? "en-IN" : "en");

export function formatMoney(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  return new Intl.NumberFormat(moneyLocale(currency), {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/** Currency to preselect at onboarding, from the device's time zone (India → INR; unknown → INR). */
export function guessCurrency(fallback = "", timeZone?: string): string {
  try {
    const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (/^Asia\/(Kolkata|Calcutta)$/.test(tz)) return "INR";
    if (tz === "Europe/London") return "GBP";
    if (/^America\//.test(tz)) return "USD";
    if (/^Australia\//.test(tz)) return "AUD";
    if (/^Europe\//.test(tz)) return "EUR";
    if (tz === "Asia/Dubai") return "AED";
    if (tz === "Asia/Singapore") return "SGD";
  } catch {
    /* use the fallback */
  }
  return fallback || "INR";
}
