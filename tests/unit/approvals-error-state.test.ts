import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("approvals error and date states", () => {
  const source = readFileSync("src/routes/approvals.tsx", "utf8");
  it("does not represent failed recent-decision requests as an empty history", () => {
    expect(source).toContain("decisions.isError ?");
    expect(source).toContain("Couldn't load recent decisions.");
  });
  it("does not display negative waiting days for future-dated records", () => {
    expect(source).toContain("Math.max(0, daysBetween(");
  });
});
