#!/usr/bin/env node
/**
 * Prerenders the public pages into static HTML after `vite build`, for search engines and a faster first paint.
 *
 *   dist/index.html    stays the empty app shell: Cloudflare serves it for every app path (/dashboard, /p, …).
 *   dist/home.html     the home page; _redirects serves it at "/" (a rewrite, the address stays "/").
 *   dist/pricing.html, privacy.html, terms.html   served at /pricing, /privacy, /terms.
 *   dist/sitemap.xml   generated from the same page list.
 *
 * Each page gets its own <title>, description, canonical address, link-preview tags and schema.org data.
 * In the browser, main.tsx hydrates the markup instead of re-rendering it.
 */
import { build } from "vite";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "node_modules/.cache/scopeflow-prerender");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** JSON inside <script>: "<" can never close the tag or open a comment. */
const scriptJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

function replaceOnce(html, pattern, replacement, what) {
  if (!pattern.test(html)) throw new Error(`prerender: index.html has no ${what}`);
  return html.replace(pattern, replacement);
}

/** Chunks a public page doesn't need to paint: the app's code and other pages. */
const LATER = ["supabase", "blog", "pricing", "app-shell", "not-found", "toast", "signup-source"];

/**
 * First paint on phones (T2-10). The page is complete HTML already, so the app's code shouldn't
 * compete with what the visitor is looking at:
 *  - every prerendered page stops preloading chunks it doesn't need for first paint;
 *  - a page with a hero image (heroPreloads) also starts the app only once that image has arrived
 *    (public/boot.js), and preloads the image from <head>.
 */
export function lightenHead(html, { path, heroPreloads = [] }) {
  const keep = path === "/pricing" ? LATER.filter((n) => n !== "pricing") : LATER;
  let out = html.replace(new RegExp(`\\s*<link rel="modulepreload"[^>]*href="/assets/(?:${keep.join("|")})-[^"]*"[^>]*>`, "g"), "");
  if (!heroPreloads.length) return out;
  const entry = /<script type="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/.exec(out);
  if (!entry) throw new Error("prerender: index.html has no module entry script");
  out = out.replace(entry[0], `<script defer src="/boot.js" data-entry="${esc(entry[1])}"></script>`);
  out = out.replace(/\s*<link rel="modulepreload"[^>]*>/g, "");
  // Straight after the viewport tag, so the browser finds the image before anything else.
  return replaceOnce(out, /(<meta name="viewport"[^>]*>)/, `$1\n    ${heroPreloads.join("\n    ")}`, "viewport tag");
}

export function pageHtml(template, { path, seo, body, state, jsonLd, fonts, canonical, ogImage, heroPreloads = [] }) {
  let html = lightenHead(template, { path, heroPreloads });
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${esc(seo.title)}</title>`, "<title>");
  html = replaceOnce(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(seo.description)}" />`, "description");
  html = replaceOnce(html, /<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${esc(seo.title)}" />`, "og:title");
  html = replaceOnce(html, /<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${esc(seo.description)}" />`, "og:description");
  html = replaceOnce(html, /<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${esc(canonical)}" />`, "og:url");
  html = replaceOnce(html, /<meta property="og:image" content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${esc(ogImage)}" />`, "og:image");
  const head = [
    `<link rel="canonical" href="${esc(canonical)}" />`,
    ...fonts.map((f) => `<link rel="preload" href="/assets/${esc(f)}" as="font" type="font/woff2" crossorigin />`),
    // Scroll-reveal sections start hidden until the script shows them; without JavaScript, show everything.
    `<noscript><link rel="stylesheet" href="/noscript.css" /></noscript>`,
    `<script type="application/ld+json">${scriptJson(jsonLd)}</script>`,
  ].join("\n    ");
  html = replaceOnce(html, /\s*<\/head>/, `\n    ${head}\n  </head>`, "</head>");
  html = html.replace(/\s*<noscript>ScopeFlow needs JavaScript enabled\.<\/noscript>/, "");
  const data = state ? `\n    <script type="application/json" id="sf-state">${scriptJson(state)}</script>` : "";
  html = replaceOnce(html, /<div id="root"><\/div>/, `<div id="root" data-page="${esc(path)}">${body}</div>${data}`, "empty #root");
  return html;
}

export function sitemapXml(pages, canonicalUrl) {
  const urls = Object.entries(pages).map(
    ([path, p]) => `  <url><loc>${esc(canonicalUrl(path))}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

async function main() {
  const template = readFileSync(join(DIST, "index.html"), "utf8");
  if (!template.includes('<div id="root"></div>')) throw new Error("prerender: dist/index.html isn't a fresh build (run vite build first)");

  await build({
    logLevel: "warn",
    mode: process.env.NODE_ENV === "development" ? "development" : "production",
    build: {
      ssr: "src/prerender.tsx",
      outDir: OUT,
      emptyOutDir: true,
      copyPublicDir: false,
      rollupOptions: { output: { entryFileNames: "prerender.mjs" } },
    },
  });
  const mod = await import(pathToFileURL(join(OUT, "prerender.mjs")).href);
  const assets = readdirSync(join(DIST, "assets"));
  const font = (re) => assets.find((f) => re.test(f));
  const inter = font(/^inter-latin-wght-normal-[\w-]+\.woff2$/);

  for (const [path, seo] of Object.entries(mod.PUBLIC_PAGES)) {
    const { html: body, state } = await mod.render(path);
    if (!body.includes("<h1")) throw new Error(`prerender: ${path} rendered without a heading`);
    // Every public page, the home page included, sets its type in Inter.
    const fonts = [inter].filter(Boolean);
    const html = pageHtml(template, {
      path,
      seo,
      body,
      state,
      jsonLd: mod.structuredData(path),
      fonts,
      canonical: mod.canonicalUrl(path),
      ogImage: mod.OG_IMAGE,
      heroPreloads: path === "/" ? mod.heroPreloads() : [],
    });
    writeFileSync(join(DIST, seo.file), html);
    console.log(`✓ Prerendered ${path} → dist/${seo.file} (${Math.round(html.length / 1024)} KB${state ? ", with data" : ""})`);
  }
  writeFileSync(join(DIST, "sitemap.xml"), sitemapXml(mod.PUBLIC_PAGES, mod.canonicalUrl));
  if (!existsSync(join(DIST, "_redirects"))) throw new Error("prerender: dist/_redirects is missing (public/_redirects serves the home page)");
  rmSync(OUT, { recursive: true, force: true });
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  main().then(
    () => process.exit(0), // the Supabase client may hold timers open
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
