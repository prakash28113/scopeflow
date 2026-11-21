import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { waitingDays, waitingLabel } from "@/lib/approvals";
import { RecentDecisions } from "@/routes/approvals";

const html = (state: Parameters<typeof RecentDecisions>[0]["state"]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RecentDecisions, { state, onRetry: () => {} }))).replace(/&#x27;/g, "'");

describe("Approvals: waiting days", () => {
  it("counts whole days on the India calendar", () => {
    expect(waitingDays("2026-11-12T06:00:00Z", "2026-11-15")).toBe(3);
    expect(waitingDays("2026-11-15T03:00:00Z", "2026-11-15")).toBe(0);
    // 20:00 UTC on the 14th is already the 15th in India: sent today, not yesterday.
    expect(waitingDays("2026-11-14T20:00:00Z", "2026-11-15")).toBe(0);
    expect(waitingDays("2026-11-14T18:00:00Z", "2026-11-15")).toBe(1);
  });
  it("is never negative", () => {
    // A timestamp ahead of this device's date (clock skew, or a device clock set wrong).
    expect(waitingDays("2026-11-16T09:00:00Z", "2026-11-15")).toBe(0);
    expect(waitingDays("2027-01-01T00:00:00Z", "2026-11-15")).toBe(0);
    expect(waitingDays(undefined, "2026-11-15")).toBe(0);
    expect(waitingDays(null, "2026-11-15")).toBe(0);
    expect(waitingDays("not a date", "2026-11-15")).toBe(0);
    for (const ts of ["2026-11-15T23:59:59Z", "2026-11-17T00:00:00+05:30", "2030-05-05T00:00:00Z"]) {
      expect(waitingDays(ts, "2026-11-15")).toBeGreaterThanOrEqual(0);
    }
  });
  it("labels", () => {
    expect([0, 1, 2, -3].map(waitingLabel)).toEqual(["Today", "1 day", "2 days", "Today"]);
  });
  it("the page uses these for both lists, and no inline day maths is left", () => {
    const page = readFileSync("src/routes/approvals.tsx", "utf8");
    expect(page).toContain("const waited = (iso: string | undefined) => waitingDays(iso, today);");
    expect(page.match(/\{waitingLabel\(days\)\}/g)).toHaveLength(2);
    expect(page).not.toMatch(/iso\.slice\(0, 10\)|daysBetween/);
  });
});

describe("Approvals: recent decisions", () => {
  const one = [{ id: "a1", event: "scope.approved", summary: "Scope v1 approved by Dana", created_at: "2026-11-14T06:00:00Z", project_id: "p1", projects: { title: "Brand kit" } }];
  it("a failed request shows an error with Try again, never 'No decisions yet'", () => {
    const out = html({ isLoading: false, isError: true, data: undefined });
    expect(out).toContain("Couldn't load recent decisions.");
    expect(out).toContain("Try again");
    expect(out).toContain('data-testid="decisions-error"');
    expect(out).not.toContain("No decisions yet");
  });
  it("an error with stale data still says it failed", () => {
    expect(html({ isLoading: false, isError: true, data: one })).toContain("Couldn't load recent decisions.");
  });
  it("loading, empty and filled read differently", () => {
    expect(html({ isLoading: true, isError: false })).toContain("Loading…");
    const empty = html({ isLoading: false, isError: false, data: [] });
    expect(empty).toContain("No decisions yet");
    expect(empty).not.toContain("Couldn't load");
    const filled = html({ isLoading: false, isError: false, data: one });
    expect(filled).toContain("Scope v1 approved by Dana");
    expect(filled).toContain("Approved");
    expect(filled).not.toContain("No decisions yet");
  });
  it("a decision whose project is gone still renders", () => {
    expect(html({ isLoading: false, isError: false, data: [{ ...one[0], projects: null }] })).toContain("Project, ");
  });
});

describe("Backups run daily", () => {
  const yml = readFileSync(".github/workflows/backup.yml", "utf8");
  it("the schedule is every day, and can still be run by hand", () => {
    const crons = [...yml.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
    expect(crons).toEqual(["37 21 * * *"]);
    const [, , dom, month, dow] = crons[0].split(" ");
    expect([dom, month, dow]).toEqual(["*", "*", "*"]);
    expect(yml).toContain("workflow_dispatch:");
  });
  it("nothing else about the backup changed: encrypted, restore-checked, kept 90 days, main only", () => {
    expect(yml).toContain("run: node scripts/backup/backup.mjs");
    expect(yml).toContain("BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}");
    expect(yml).toContain("retention-days: 90");
    expect(yml).toContain("if: github.repository == 'prakash28113/scopeflow' && github.ref == 'refs/heads/main'");
    expect(yml).toContain("cancel-in-progress: false");
    expect(yml).not.toMatch(/weekly|Sunday/i);
  });
});
