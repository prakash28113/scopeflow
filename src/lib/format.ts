import type { ProjectStatus } from "./types";

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en", {
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
