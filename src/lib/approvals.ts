/**
 * How long something has been waiting for a client's decision, for the Approvals page.
 */
import { daysBetween } from "./reminders";
import { localToday } from "./upcoming";

/**
 * Whole days a scope or change order has been waiting, counted on the India calendar.
 * Never negative: a timestamp slightly ahead of this device's clock (or a clock set wrong)
 * reads as "Today", not "-1 days". Missing or unreadable timestamps also read as 0.
 */
export function waitingDays(sentAt: string | null | undefined, today: string): number {
  if (!sentAt) return 0;
  const t = Date.parse(sentAt);
  if (Number.isNaN(t)) return 0;
  const n = daysBetween(localToday(new Date(t)), today);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** "Today", "1 day", "4 days". */
export const waitingLabel = (days: number) => (days <= 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`);
