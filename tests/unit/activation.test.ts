import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACTIVATING_TEXT, ACTIVATION_DELAY_MS, ACTIVATION_TRIES, waitForPaidPlan } from "@/lib/activation";

describe("T1-04 Plan & usage waits for the captured payment", () => {
  it("says so in the agreed words and waits about a minute", () => {
    expect(ACTIVATING_TEXT).toBe("Payment received, activating… this can take a minute");
    expect(ACTIVATION_TRIES * ACTIVATION_DELAY_MS).toBe(60_000);
    const page = readFileSync(new URL("../../src/routes/plan.tsx", import.meta.url), "utf8");
    expect(page).toContain("{ACTIVATING_TEXT}");
    expect(page).toContain("waitForPaidPlan(");
  });
  it("stops as soon as the plan is paid", async () => {
    const answers = ["free", "free", "solo", "solo"];
    let reads = 0;
    const sleeps: number[] = [];
    const ok = await waitForPaidPlan(async () => answers[reads++], { sleep: async (ms) => void sleeps.push(ms) });
    expect(ok).toBe(true);
    expect(reads).toBe(3);
    expect(sleeps).toEqual([1500, 1500]);
  });
  it("gives up after the last try, and a failed read counts as not yet", async () => {
    let reads = 0;
    const ok = await waitForPaidPlan(async () => { if (reads++ % 2) throw new Error("offline"); return "free"; }, { sleep: async () => {} });
    expect(ok).toBe(false);
    expect(reads).toBe(ACTIVATION_TRIES);
  });
});
