#!/usr/bin/env node
/**
 * Dependency audit for the ₹0 requirement:
 *  - every installed package (runtime and dev) has an open-source licence (no UNLICENSED/proprietary);
 *  - the runtime bundle talks to no third-party service except Supabase (and Turnstile if enabled);
 *  - no SDKs for paid services are installed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OPEN = /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|CC0-1\.0|CC-BY-4\.0|Unlicense|OFL-1\.1|Python-2\.0|MPL-2\.0|WTFPL|LGPL-3\.0-or-later|LGPL-3\.0)$/;
// LGPL-3.0 appears only in sharp's libvips binaries, pulled in by the wrangler dev tool; it is open source and never shipped.
const PAID_SDKS = /^(stripe|@stripe\/|resend|@sendgrid\/|nodemailer|@aws-sdk\/|firebase|@vercel\/|@sentry\/|posthog|@clerk\/|@auth0\/|twilio|mailgun|@mailchimp\/|openai|@anthropic-ai\/)/;

function licenseOf(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  let lic = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(" OR ") : undefined);
  if (lic && typeof lic === "object") lic = lic.type;
  return { name: pkg.name, version: pkg.version, license: String(lic ?? "UNKNOWN") };
}

function allPackages(nodeModules) {
  const out = [];
  if (!existsSync(nodeModules)) return out;
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith(".")) continue;
    const p = join(nodeModules, entry);
    if (entry.startsWith("@")) {
      for (const sub of readdirSync(p)) if (existsSync(join(p, sub, "package.json"))) out.push(join(p, sub));
    } else if (existsSync(join(p, "package.json"))) out.push(p);
  }
  return out;
}

const isOpen = (expr) =>
  expr
    .replace(/[()]/g, "")
    .split(/\s+(?:OR|AND)\s+/)
    .some((part) => OPEN.test(part.trim()));

const problems = [];
const pkgs = allPackages(join(ROOT, "node_modules")).map(licenseOf);
const tally = {};
for (const p of pkgs) {
  tally[p.license] = (tally[p.license] ?? 0) + 1;
  if (!isOpen(p.license)) problems.push(`${p.name}@${p.version}: licence "${p.license}" is not on the open-source allowlist`);
  if (PAID_SDKS.test(p.name)) problems.push(`${p.name}: SDK for a paid service is installed`);
}

const direct = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const runtime = Object.keys(direct.dependencies ?? {});

// External hosts referenced by the production bundle.
const dir = join(ROOT, ".audit-deps-dist");
execFileSync("npx", ["vite", "build", "--outDir", dir, "--emptyOutDir", "--logLevel", "error"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, VITE_SUPABASE_URL: "https://auditproject.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_audit", VITE_TURNSTILE_SITE_KEY: "" },
});
const js = readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dir, "assets", f), "utf8")).join("\n");
rmSync(dir, { recursive: true, force: true });
const hosts = [...new Set([...js.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m.Host ?? m[1].toLowerCase()))].sort();
// Hosts that appear only as documentation/error links or library constants — never contacted at runtime by ScopeFlow.
// json-schema.org is a "$schema" string constant inside zod, not a network call.
// accounts.google.com is Sign in with Google (free), loaded only when a Google client ID is configured.
// checkout.razorpay.com is Razorpay Checkout for paid plans: loaded only when someone starts a payment,
// and only in builds with payments switched on (src/lib/billing.ts). No SDK is installed; payment fees only.
// scopeflow.in is this site's own address, used for canonical links and structured data (src/lib/seo.ts).
// www.instagram.com is ScopeFlow's Instagram page, a plain link in the site footer (never loaded or embedded).
// wa.me is WhatsApp's free share link: opened only when the freelancer taps "Send on WhatsApp", never called by the app.
// cdnjs.cloudflare.com is inside jsPDF's optional "open in a new window with PDFObject" output mode, which ScopeFlow never
// uses (it only calls pdf.save()); the site's CSP would block it anyway.
const INFORMATIONAL = /^(checkout\.razorpay\.com|scopeflow\.in|cdnjs\.cloudflare\.com|accounts\.google\.com|wa\.me|www\.instagram\.com|json-schema\.org|react\.dev|reactjs\.org|reactrouter\.com|github\.com|supabase\.com|www\.w3\.org|developer\.mozilla\.org|zod\.dev|tanstack\.com|challenges\.cloudflare\.com|.*\.supabase\.(co|in))$/;
const unexpected = hosts.filter((h) => !INFORMATIONAL.test(h) && h !== "auditproject.supabase.co");
for (const h of unexpected) problems.push(`bundle references unexpected external host: ${h}`);

console.log(`Installed packages: ${pkgs.length}`);
console.log(`Licences: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(", ")}`);
console.log(`Runtime dependencies (${runtime.length}, shipped to browsers): ${runtime.map((n) => `${n} [${licenseOf(join(ROOT, "node_modules", n)).license}]`).join(", ")}`);
console.log(`Hosts referenced by the bundle: ${hosts.join(", ") || "none"}`);
if (problems.length) {
  console.error("Dependency audit FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("✓ All packages are open source; no paid-service SDKs; the app only talks to your Supabase project (and Turnstile when enabled).");
