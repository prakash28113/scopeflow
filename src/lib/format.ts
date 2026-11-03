import type { ProjectStatus } from "./types";

/**
 * Calendar dates (YYYY-MM-DD: due dates, milestones) are shown exactly as agreed, in any time zone.
 * Moments (timestamps: approved, paid) are shown as the date in the viewer's own time zone.
 */
export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Intl.DateTimeFormat("en", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  return new Intl.DateTimeFormat("en", { ...opts, ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en", {
    ...(timeZone ? { timeZone } : {}),
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
