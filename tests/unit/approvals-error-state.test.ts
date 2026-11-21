import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Behaviour is tested in approvals.test.ts; these guard the wiring in the route.
describe("approvals error and date states", () => {
  const source = readFileSync("src/routes/approvals.tsx", "utf8");
  it("does not represent failed recent-decision requests as an empty history", () => {
    expect(source).toContain("state.isError ?");
    expect(source).toContain("Couldn't load recent decisions.");
  });
  it("waiting days come from the shared helper that never goes negative", () => {
    expect(source).toContain("waitingDays(iso, today)");
    expect(readFileSync("src/lib/approvals.ts", "utf8")).toContain("n > 0 ? n : 0");
  });
});
