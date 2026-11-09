import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error — plain ESM script
import { checkSpelling, findMisspellings } from "../../scripts/spelling-check.mjs";

const SURNAME = "Mummidisett" + "y";
const BRAND = "Scope" + "flow";

describe("T2-02 spelling check", () => {
  it("finds the old surname and the brand with a small f", () => {
    expect(findMisspellings(`By Prakash ${SURNAME}. ${BRAND} helps.`).map((f: { word: string }) => f.word)).toEqual([SURNAME, BRAND]);
    expect(findMisspellings(`"author":{"name":"Prakash ${SURNAME}"}`)).toHaveLength(1);
    expect(findMisspellings(`<p>${BRAND}</p> (${BRAND}) ${BRAND}'s`)).toHaveLength(3);
  });
  it("leaves the right spelling, the domain, addresses and emails alone", () => {
    for (const ok of ["ScopeFlow by Prakash Mummidisetti", "scopeflow.in", "https://scopeflow.in/pricing", "no-reply@scopeflow.in", "Scopeflow.in", "support@Scopeflow.in", "github.com/prakash28113/scopeflow", "x-scopeflow-id", "SCOPEFLOW"]) {
      expect(findMisspellings(ok), ok).toEqual([]);
    }
  });
  it("fails on a fixture build that contains them and names the file and line", () => {
    const root = mkdtempSync(join(tmpdir(), "sf-spell-"));
    mkdirSync(join(root, "dist", "blog"), { recursive: true });
    writeFileSync(join(root, "dist", "home.html"), "<h1>ScopeFlow</h1>\n<p>scopeflow.in</p>");
    writeFileSync(join(root, "dist", "blog", "post.html"), `<h1>Quotes</h1>\n<p>By Prakash ${SURNAME}</p>\n<p>${BRAND} helps.</p>`);
    writeFileSync(join(root, "dist", "photo.png"), `${SURNAME}`); // not text: skipped
    expect(checkSpelling([join(root, "dist"), join(root, "missing")], root)).toEqual([`dist/blog/post.html:2 "${SURNAME}"`, `dist/blog/post.html:3 "${BRAND}"`]);
  });
  it("passes on the real source, and on the real build when there is one", () => {
    expect(checkSpelling(["src"])).toEqual([]);
    if (existsSync("dist/index.html")) expect(checkSpelling(["dist"])).toEqual([]);
    expect(execFileSync("node", ["scripts/spelling-check.mjs", "src"], { encoding: "utf8" })).toContain("✓ Spelling");
  });
  it("runs before every deploy", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("scripts/predeploy-check.mjs", "utf8")).toContain('checkSpelling([join(ROOT, "src"), dist], ROOT)');
  });
});
