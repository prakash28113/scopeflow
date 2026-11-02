#!/usr/bin/env node
/**
 * Refuses to deploy unless the build and Worker config are real and consistent.
 * Run automatically by `npm run deploy` (before `wrangler deploy`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const errors = [];
const fail = (m) => errors.push(m);

const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
// CI (scripts/ci/release.mjs) passes the values via environment and `wrangler deploy --var`;
// a manual deploy reads them from wrangler.jsonc.
const vars = {
  url: process.env.SUPABASE_URL || wrangler.match(/"SUPABASE_URL"\s*:\s*"([^"]*)"/)?.[1] || "",
  key: process.env.SUPABASE_ANON_KEY || wrangler.match(/"SUPABASE_ANON_KEY"\s*:\s*"([^"]*)"/)?.[1] || "",
};
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(vars.url)) fail(`SUPABASE_URL is not a real Supabase URL: "${vars.url}"`);
if (!vars.key || /YOUR-|your-/.test(vars.key)) fail("SUPABASE_ANON_KEY is still a placeholder");
if (/sb_secret_|service_role/.test(wrangler)) fail("wrangler.jsonc must never contain a secret or service-role key");

const dist = join(ROOT, "dist");
if (!existsSync(join(dist, "index.html"))) fail("dist/ is missing — run the build first");
else {
  const headers = existsSync(join(dist, "_headers")) ? readFileSync(join(dist, "_headers"), "utf8") : "";
  if (!headers.includes("Content-Security-Policy")) fail("dist/_headers with a CSP is missing");
  if (vars.url && !headers.includes(vars.url)) fail(`The build's CSP does not allow ${vars.url} — was it built for a different Supabase project?`);
  const js = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dist, "assets", f), "utf8")).join("\n");
  if (vars.url && !js.includes(vars.url)) fail("The built app points at a different Supabase URL than wrangler.jsonc");
  // Local stack URLs and doc placeholders. (Bare "127.0.0.1" appears inside supabase-js itself, so match full URLs.)
  if (/https?:\/\/(127\.0\.0\.1|localhost):54321|example\.supabase\.co|your-project-ref|YOUR-PROJECT-REF/.test(js)) fail("The build contains a local/test/placeholder Supabase URL");
  if (readdirSync(dist).some((f) => f.startsWith(".env") || f.endsWith(".map"))) fail("dist/ contains a .env or source map");
  // Search engines: the shell stays empty (it's served for every app address) and each public page is prerendered.
  if (!readFileSync(join(dist, "index.html"), "utf8").includes('<div id="root"></div>')) fail("dist/index.html must be the empty app shell");
  for (const [file, path] of [["home.html", "/"], ["pricing.html", "/pricing"], ["privacy.html", "/privacy"], ["terms.html", "/terms"]]) {
    const html = existsSync(join(dist, file)) ? readFileSync(join(dist, file), "utf8") : "";
    if (!html.includes(`data-page="${path}"`) || !html.includes('rel="canonical"')) fail(`dist/${file} is missing or not prerendered — run npm run build`);
  }
  const redirects = existsSync(join(dist, "_redirects")) ? readFileSync(join(dist, "_redirects"), "utf8") : "";
  if (!/^\/ \/home 200$/m.test(redirects)) fail("dist/_redirects must serve the prerendered home page at /");
  if (!existsSync(join(dist, "sitemap.xml"))) fail("dist/sitemap.xml is missing");
}

if (errors.length) {
  console.error("Pre-deploy check FAILED — nothing was deployed:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`✓ Pre-deploy check passed for ${vars.url}`);
