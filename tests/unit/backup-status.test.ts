import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module (scripts run by GitHub Actions)
import { OVERRIDE_PHRASE, checkBackupGate, evaluateGate } from "../../scripts/ci/backup-status.mjs";

const NOW = new Date("2026-11-22T12:00:00Z");
const run = (id: number, finished: string, conclusion = "success", extra = {}) => ({ id, status: "completed", conclusion, head_branch: "main", created_at: finished, updated_at: finished, ...extra });
const art = (name = "scopeflow-backup-2026-11-22", size = 55288, expired = false) => ({ name, size_in_bytes: size, expired });

describe("backup release gate: the decision", () => {
  it("passes: latest run green, fresh, with a real unexpired artifact", () => {
    const g = evaluateGate({ runs: [run(5, "2026-11-22T03:00:00Z")], artifacts: [art()], now: NOW });
    expect(g.ok).toBe(true);
    expect(g.text).toMatch(/run #5 succeeded 9 hours ago; artifact scopeflow-backup-2026-11-22/);
  });
  it("fails when the latest run failed, even if an older one was green", () => {
    const g = evaluateGate({ runs: [run(6, "2026-11-22T03:00:00Z", "failure"), run(5, "2026-11-21T03:00:00Z")], artifacts: [art()], now: NOW });
    expect(g.ok).toBe(false);
    expect(g.text).toMatch(/#6\) failure.*last good backup is 33 hours old/);
  });
  it("fails when no backup ever succeeded or no run exists or the run was cancelled", () => {
    expect(evaluateGate({ runs: [run(6, "2026-11-22T03:00:00Z", "failure")], artifacts: [], now: NOW }).text).toMatch(/No successful backup is on record/);
    expect(evaluateGate({ runs: [], artifacts: [], now: NOW })).toMatchObject({ ok: false });
    expect(evaluateGate({ runs: [run(6, "2026-11-22T03:00:00Z", "cancelled")], artifacts: [], now: NOW }).ok).toBe(false);
  });
  it("fails when the good backup is older than 36 hours; passes at exactly 36", () => {
    expect(evaluateGate({ runs: [run(5, "2026-11-20T23:00:00Z")], artifacts: [art()], now: NOW }).text).toMatch(/37 hours old; the limit is 36/);
    expect(evaluateGate({ runs: [run(5, "2026-11-21T00:00:00Z")], artifacts: [art()], now: NOW }).ok).toBe(true);
  });
  it("fails when the artifact is missing, expired, too small, or not a backup file", () => {
    const r = [run(5, "2026-11-22T03:00:00Z")];
    expect(evaluateGate({ runs: r, artifacts: [], now: NOW }).text).toMatch(/no unexpired encrypted backup artifact/);
    expect(evaluateGate({ runs: r, artifacts: [art(undefined, 55288, true)], now: NOW }).ok).toBe(false);
    expect(evaluateGate({ runs: r, artifacts: [art(undefined, 12)], now: NOW }).text).toMatch(/too small/);
    expect(evaluateGate({ runs: r, artifacts: [art("verify-reports")], now: NOW }).ok).toBe(false);
  });
  it("fails for a run that was not on main", () => {
    expect(evaluateGate({ runs: [run(5, "2026-11-22T03:00:00Z", "success", { head_branch: "feature/x" })], artifacts: [art()], now: NOW }).ok).toBe(false);
  });
});

describe("backup release gate: asking GitHub", () => {
  const gh = (runs: unknown[], artifacts: unknown[] = [art()], status = 200) =>
    async (url: string) => {
      if (url.includes("/artifacts")) return new Response(JSON.stringify({ artifacts }), { status });
      return new Response(JSON.stringify({ workflow_runs: runs }), { status });
    };
  const ask = (fetch: unknown, extra = {}) => checkBackupGate({ fetch, repo: "o/r", token: "t", now: NOW, ...extra });

  it("is read-only: GETs the runs of backup.yml on main and the latest run's artifacts, with the token as a header", async () => {
    const urls: string[] = [];
    const calls: { method?: string; headers: Record<string, string> }[] = [];
    const g = await ask(async (u: string, init: { method?: string; headers: Record<string, string> }) => (urls.push(u), calls.push(init), gh([run(5, "2026-11-22T03:00:00Z")])(u)));
    expect(g.ok).toBe(true);
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/actions/workflows/backup.yml/runs?branch=main&status=completed&per_page=10");
    expect(urls[1]).toBe("https://api.github.com/repos/o/r/actions/runs/5/artifacts");
    for (const c of calls) { expect(c.method).toBeUndefined(); expect(c.headers.Authorization).toBe("Bearer t"); }
  });
  it("fails closed when GitHub errors, is down, or there is no token", async () => {
    expect((await ask(gh([], [], 500))).text).toMatch(/GitHub answered 500/);
    expect((await ask(async () => { throw new Error("offline"); })).text).toMatch(/didn't answer/);
    expect((await checkBackupGate({ fetch: gh([]), repo: "", token: "", now: NOW })).text).toMatch(/no GitHub token/);
  });
  it("the typed override passes a failing gate, loudly; a wrong phrase doesn't", async () => {
    const failing = gh([run(6, "2026-11-22T03:00:00Z", "failure")]);
    const o = await ask(failing, { override: OVERRIDE_PHRASE });
    expect(o).toMatchObject({ ok: true, overridden: true });
    expect(o.text).toMatch(/^OVERRIDDEN\./);
    expect((await ask(failing, { override: "yes please" })).ok).toBe(false);
    expect((await ask(gh([run(5, "2026-11-22T03:00:00Z")]), { override: OVERRIDE_PHRASE })).overridden).toBeUndefined();
  });
});
