import type { ProjectStatus } from "./types";

/** ScopeFlow's business time zone: invoices are dated in it, and moments are shown in it. */
export const APP_TIME_ZONE = "Asia/Kolkata";

/**
 * Calendar dates (YYYY-MM-DD: due dates, milestones) are shown exactly as agreed, in any time zone.
 * Moments (timestamps: approved, paid, voided) are shown in India time by default, so they match the
 * invoice dates whatever time zone the device is set to.
 */
export function formatDate(iso: string | null | undefined, timeZone: string = APP_TIME_ZONE): string {
  if (!iso) return "—";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Intl.DateTimeFormat("en", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  return new Intl.DateTimeFormat("en", { ...opts, timeZone }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone: string = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  changes_requested: "Changes requested",
  active: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** A moment's time of day ("6:54 PM"), in India time by default. */
export function formatTime(iso: string, timeZone: string = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Today's date for a greeting ("Wednesday, 4 November"), in India time by default. */
export function formatToday(now = new Date(), timeZone: string = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(now);
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 4)} ${hash.slice(4, 8)} ${hash.slice(8, 12)}`.toUpperCase();
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Indian financial year for a date (1 April to 31 March), e.g. "2026-27". Defaults to today in India. */
export function financialYear(date?: Date): string {
  const d = date ?? new Date();
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .format(d)
    .split("-")
    .map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
