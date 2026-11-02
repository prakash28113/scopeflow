#!/usr/bin/env node
/**
 * Secret scan for the production build and the repository.
 *
 *   node scripts/secret-scan.mjs            # build into .audit-dist with a test config, scan it, scan git files
 *   node scripts/secret-scan.mjs --dir dist # scan an existing build output only
 *
 * Fails (exit 1) on: any JWT whose role isn't "anon", Supabase secret keys,
 * private keys, common provider tokens, database URLs with passwords, names of
 * server-only env vars, source maps, or dotenv files in the build output.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PATTERNS = [
  ["Supabase secret API key", /\bsb_secret_[A-Za-z0-9_-]{10,}/g],
  ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Stripe secret key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/g],
  ["Resend API key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["Database URL with password", /\bpostgres(?:ql)?:\/\/[^\s"'`:@/]+:[^\s"'`@/]+@/g],
  ["Server-only env var name", /\b(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SHARE_TOKEN_SECRET|RESEND_API_KEY|TURNSTILE_SECRET_KEY|JWT_SECRET)\b/g],
];
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).role ?? "(none)";
  } catch {
    return "(undecodable)";
  }
}

export function scanText(text, { allowServerEnvNames = false } = {}) {
  const findings = [];
  for (const [name, re] of PATTERNS) {
    if (allowServerEnvNames && name === "Server-only env var name") continue;
    for (const m of text.matchAll(re)) findings.push(`${name}: ${m[0].slice(0, 24)}…`);
  }
  for (const m of text.matchAll(JWT)) {
    const role = jwtRole(m[0]);
    if (role !== "anon") findings.push(`JWT with role "${role}"`);
  }
  return findings;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function scanBuildDir(dir) {
  const problems = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file);
    if (/\.map$/.test(rel)) problems.push(`${rel}: source map in build output`);
    if (/(^|\/)\.env/.test(rel)) problems.push(`${rel}: dotenv file in build output`);
    if (/\.(woff2?|png|jpe?g|gif|webp|ico)$/.test(rel)) continue;
    for (const f of scanText(readFileSync(file, "utf8"))) problems.push(`${rel}: ${f}`);
  }
  return problems;
}

function scanRepo() {
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = [];
  for (const rel of files) {
    if (/\.(woff2?|png|jpe?g|gif|webp|ico|lock)$|package-lock\.json$/.test(rel)) continue;
    if (/^\.env(?!\.example$)/.test(rel.split("/").pop())) problems.push(`${rel}: dotenv file committed`);
    // Docs, this scanner and its tests legitimately name server-only variables.
    // Server-only code may read server-only variables by name: Supabase Edge Functions run on Supabase, are
    // never bundled into the app, and receive the values at run time. The build scan still forbids them in dist/.
    const allowNames = /\.(md)$|^scripts\/secret-scan\.mjs$|^tests\/|^supabase\/functions\//.test(rel);
    for (const f of scanText(readFileSync(join(ROOT, rel), "utf8"), { allowServerEnvNames: allowNames })) problems.push(`${rel}: ${f}`);
  }
  return { problems, count: files.length };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const dirArg = process.argv.indexOf("--dir");
  let dir;
  let built = false;
  if (dirArg > -1) dir = join(ROOT, process.argv[dirArg + 1]);
  else {
    dir = join(ROOT, ".audit-dist");
    // A realistic public config: an anon JWT and a Turnstile site key (both public by design).
    const anon = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", Buffer.from(JSON.stringify({ iss: "supabase", ref: "auditproject", role: "anon" })).toString("base64url"), "c2lnbmF0dXJlLW5vdC1yZWFs"].join(".");
    execFileSync("npx", ["vite", "build", "--outDir", dir, "--emptyOutDir", "--logLevel", "error"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, VITE_SUPABASE_URL: "https://auditproject.supabase.co", VITE_SUPABASE_ANON_KEY: anon, VITE_TURNSTILE_SITE_KEY: "0x4AAAAAAAAuditSiteKey" },
    });
    built = true;
  }
  const buildProblems = scanBuildDir(dir);
  const files = walk(dir).length;
  const repo = dirArg > -1 ? { problems: [], count: 0 } : scanRepo();
  if (built && existsSync(dir)) rmSync(dir, { recursive: true, force: true });

  const all = [...buildProblems.map((p) => `build/${p}`), ...repo.problems.map((p) => `repo/${p}`)];
  console.log(`Scanned ${files} build files${repo.count ? ` and ${repo.count} tracked repository files` : ""}.`);
  if (all.length) {
    console.error("Secret scan FAILED:\n  " + all.join("\n  "));
    process.exit(1);
  }
  console.log("✓ No secrets found. Only the public anon key and public site configuration are present in the build.");
}
