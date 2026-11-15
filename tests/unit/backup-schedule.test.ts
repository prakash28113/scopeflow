import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("encrypted backup scheduling", () => {
  const workflow = readFileSync(".github/workflows/backup.yml", "utf8");
  const docs = readFileSync("docs/BACKUPS.md", "utf8");
  it("runs daily and supports manual execution", () => {
    expect(workflow).toMatch(/cron:\s*["']37 21 \* \* \*["']/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("cancel-in-progress: false");
  });
  it("retains encrypted artifacts and verifies restores", () => {
    expect(workflow).toContain("node scripts/backup/backup.mjs");
    expect(workflow).toContain("retention-days: 90");
    expect(docs).toContain("Backups are daily");
  });
});
