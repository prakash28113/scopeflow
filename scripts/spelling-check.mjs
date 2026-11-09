#!/usr/bin/env node
/**
 * Fails when the source or the built site spells the brand or the owner's surname wrongly:
 * "ScopeFlow" has a capital F, and the surname ends in "-setti".
 * The lowercase domain (scopeflow.in) and email addresses are fine.
 * Run by scripts/predeploy-check.mjs before every deploy, and by `npm run audit:spelling`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const SURNAME = new RegExp("Mummidisett" + "y", "g");
// The whole word with a small f: not part of a longer word, an email address or a domain.
const BRAND = new RegExp("(?<![\\w@./-])Scope" + "flow(?![\\w@]|\\.[a-z])", "g");
const TEXT = /\.(html|js|mjs|ts|tsx|css|json|txt|xml|md|svg|webmanifest)$/;

/** @returns {{ word: string, index: number }[]} */
export function findMisspellings(text) {
  const found = [];
  for (const re of [SURNAME, BRAND]) for (const m of text.matchAll(re)) found.push({ word: m[0], index: m.index });
  return found.sort((a, b) => a.index - b.index);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (TEXT.test(name)) yield p;
  }
}

/** Checks every text file under the given folders. @returns {string[]} one line per problem */
export function checkSpelling(dirs, root = process.cwd()) {
  const problems = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const text = readFileSync(file, "utf8");
      for (const f of findMisspellings(text)) {
        const line = text.slice(0, f.index).split("\n").length;
        problems.push(`${relative(root, file)}:${line} "${f.word}"`);
      }
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const dirs = (process.argv.slice(2).length ? process.argv.slice(2) : ["src", "dist"]).map((d) => join(root, d));
  const problems = checkSpelling(dirs, root);
  if (problems.length) {
    console.error(`✗ Spelling: write "ScopeFlow" and "Prakash Mummidisetti".\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log('✓ Spelling: "ScopeFlow" and "Mummidisetti" throughout.');
}
