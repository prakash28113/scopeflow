import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dismiss, getStartedSteps, isDismissed, showGetStarted, stepsDone } from "@/lib/get-started";

const none = { clients: 0, projects: 0, linksSent: 0, requests: 0 };
const done = (c: Partial<typeof none>) => getStartedSteps({ ...none, ...c }).map((s) => s.done);

describe("T2-13 Get started checklist", () => {
  it("has four steps in order, each linking to the right screen", () => {
    expect(getStartedSteps(none).map((s) => [s.label, s.to])).toEqual([
      ["Add a client", "/clients?new=1"],
      ["Write a scope", "/projects/new"],
      ["Send the approval link", "/projects/new"],
      ["Log a client request", "/projects"],
    ]);
    // With a draft and an active project, the last two go straight to them.
    const s = getStartedSteps({ ...none, clients: 1, projects: 2 }, "draft-id", "live-id");
    expect(s[2].to).toBe("/projects/draft-id");
    expect(s[3].to).toBe("/projects/live-id/record");
    expect(getStartedSteps({ ...none, projects: 1 })[2].to).toBe("/projects");
  });
  it("each step ticks from its own real data", () => {
    expect(done({})).toEqual([false, false, false, false]);
    expect(done({ clients: 1 })).toEqual([true, false, false, false]);
    expect(done({ projects: 1 })).toEqual([false, true, false, false]);
    expect(done({ linksSent: 1 })).toEqual([false, false, true, false]);
    expect(done({ requests: 3 })).toEqual([false, false, false, true]);
    expect(stepsDone(getStartedSteps({ clients: 2, projects: 1, linksSent: 1, requests: 0 }))).toBe(3);
  });
  it("shows until 4 of 4 or until it's dismissed", () => {
    expect(showGetStarted(getStartedSteps(none), false)).toBe(true);
    expect(showGetStarted(getStartedSteps({ clients: 1, projects: 1, linksSent: 1, requests: 0 }), false)).toBe(true);
    expect(showGetStarted(getStartedSteps({ clients: 1, projects: 1, linksSent: 1, requests: 1 }), false)).toBe(false);
    expect(showGetStarted(getStartedSteps(none), true)).toBe(false);
  });
  it("remembers a dismissal per account, and survives blocked storage", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(isDismissed("u1", store)).toBe(false);
    dismiss("u1", store);
    expect(isDismissed("u1", store)).toBe(true);
    expect(isDismissed("u2", store)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(isDismissed("u1", broken)).toBe(false);
    expect(() => dismiss("u1", broken)).not.toThrow();
    expect(isDismissed("u1", null)).toBe(false);
  });
  it("is on the dashboard, fed by what the account has actually done", () => {
    const dash = readFileSync("src/routes/dashboard.tsx", "utf8");
    expect(dash).toContain("<GetStarted userId={profile.data.id} projects={projects} linksSent={q.data.snapshots.length} />");
  });
});
