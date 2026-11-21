import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module (scripts run by GitHub Actions)
import { backupStatus, describeBackups } from "../../scripts/ci/backup-status.mjs";

const NOW = new Date("2026-11-21T12:00:00Z");
const run = (created_at: string, conclusion: string, status = "completed") => ({ created_at, conclusion, status });

describe("backup status for the release summary", () => {
  it("healthy: the latest run succeeded recently", () => {
    expect(describeBackups([run("2026-11-21T03:00:00Z", "success")], NOW)).toMatchObject({ ok: true });
  });
  it("warns when the latest run failed, saying how long the last good one is", () => {
    const r = describeBackups([run("2026-11-21T03:00:00Z", "failure"), run("2026-11-20T03:00:00Z", "failure"), run("2026-11-16T03:00:00Z", "success")], NOW);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/2 in a row/);
  });
  it("warns loudly when no backup ever succeeded, or none is old enough to trust", () => {
    expect(describeBackups([run("2026-11-21T03:00:00Z", "failure")], NOW).text).toMatch(/no successful backup/);
    expect(describeBackups([run("2026-11-18T03:00:00Z", "success")], NOW).ok).toBe(false);
    expect(describeBackups([], NOW).ok).toBe(false);
  });
  it("never throws and never blocks: network errors and API errors become a notice", async () => {
    expect((await backupStatus({ fetch: async () => { throw new Error("x"); }, repo: "a/b", token: "t" })).ok).toBe(false);
    expect((await backupStatus({ fetch: async () => new Response("{}", { status: 403 }), repo: "a/b", token: "t" })).text).toMatch(/403/);
    expect((await backupStatus({ fetch: async () => new Response("{}"), repo: "", token: "" })).text).toMatch(/unavailable/);
  });
});
