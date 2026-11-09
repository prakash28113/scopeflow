/**
 * Dates near midnight, in the zones furthest apart (UTC−10 to UTC+14) and India.
 * The whole unit suite also runs under TZ=Pacific/Honolulu and TZ=Pacific/Kiritimati
 * in the release pipeline (`npm run test:tz`).
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/format";
import { addDays, currentDueDate } from "@/lib/pricing";
import { localToday, upcomingItems, whenLabel } from "@/lib/upcoming";

const ZONES = ["Pacific/Honolulu", "UTC", "Asia/Kolkata", "Pacific/Kiritimati"];

describe("calendar dates (due dates, milestones) never shift with the viewer's zone", () => {
  it.each(ZONES)("%s", (tz) => {
    expect(formatDate("2026-11-30", tz)).toBe("Nov 30, 2026");
    expect(formatDate("2026-12-31", tz)).toBe("Dec 31, 2026");
    expect(formatDate("2027-01-01", tz)).toBe("Jan 1, 2027");
  });
  it("extra days from change orders cross month, year and leap-day boundaries correctly", () => {
    expect(addDays("2026-11-28", 3)).toBe("2026-12-01");
    expect(addDays("2026-12-30", 2)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(currentDueDate("2026-03-28", 2)).toBe("2026-03-30"); // across a DST change in many zones
  });
});

describe("moments (approved, paid) show the viewer's local date", () => {
  // 20:00 UTC on 1 Nov is 2 Nov in India and Kiritimati, still 1 Nov in Honolulu.
  const paid = "2026-11-01T20:00:00Z";
  it("uses the local calendar day", () => {
    expect(formatDate(paid, "Pacific/Honolulu")).toBe("Nov 1, 2026");
    expect(formatDate(paid, "Asia/Kolkata")).toBe("Nov 2, 2026");
    expect(formatDate(paid, "Pacific/Kiritimati")).toBe("Nov 2, 2026");
    expect(formatDateTime(paid, "Asia/Kolkata")).toMatch(/Nov 2, 2026, 1:30\sAM/);
  });
});

describe("overdue / upcoming is judged by the viewer's own date", () => {
  const project = {
    id: "p",
    title: "P",
    currency: "INR",
    status: "active" as const,
    due_date: null,
    extra_days: 0,
    milestones: [{ id: "m", title: "Final", amount_cents: 100, status: "pending", due_date: "2026-11-02" }],
  };
  it("a payment due 2 Nov is 'Today' in India at 01:30 IST and 'Tomorrow' in Honolulu at the same instant", () => {
    const instant = new Date("2026-11-01T20:00:00Z");
    const inIndia = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(instant);
    const inHonolulu = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu" }).format(instant);
    expect(whenLabel(upcomingItems([project], inIndia)[0].daysAway)).toBe("Today");
    expect(whenLabel(upcomingItems([project], inHonolulu)[0].daysAway)).toBe("Tomorrow");
  });
  it("T2-09 localToday is the India calendar date in every process time zone", () => {
    // IST is UTC+5:30, so the date turns over at 18:30 UTC.
    expect(localToday(new Date("2026-11-10T19:00:00Z"))).toBe("2026-11-11");
    expect(localToday(new Date("2026-11-10T18:00:00Z"))).toBe("2026-11-10");
    expect(localToday(new Date("2026-11-10T18:29:59Z"))).toBe("2026-11-10");
    expect(localToday(new Date("2026-11-10T18:30:00Z"))).toBe("2026-11-11");
    expect(localToday(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    // Another zone only if one is asked for (profiles don't store one today).
    expect(localToday(new Date("2026-11-10T19:00:00Z"), "America/New_York")).toBe("2026-11-10");
    expect(localToday(new Date("2026-11-01T12:00:00Z"))).toBe("2026-11-01");
  });
});
