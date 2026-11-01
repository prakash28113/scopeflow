// Renders PNG logo assets from the SVGs made by brand/build.py. Run: node brand/render.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = new URL("../", import.meta.url).pathname;
const icon = readFileSync(root + "public/icon.svg", "utf8");
const logo = readFileSync(root + "brand/scopeflow-logo.svg", "utf8");
const browser = await chromium.launch();
async function shot(html, w, h, out, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<style>*{margin:0}html,body{width:${w}px;height:${h}px;${transparent ? "background:transparent" : "background:#fff"}}svg{display:block;width:100%;height:100%}</style>${html}`);
  await page.screenshot({ path: root + out, omitBackground: transparent });
  await page.close();
  console.log("wrote", out);
}
// Phone home-screen icons: full-bleed white square (the OS rounds the corners).
const square = icon.replace(/<rect [^>]*\/>/, (r) => r.replace(/rx="\d+"/, 'rx="0"'));
for (const [size, out] of [[180, "public/apple-touch-icon.png"], [192, "public/icon-192.png"], [512, "public/icon-512.png"]]) await shot(square, size, size, out);
// Full logo for emails, documents and press: white background and transparent versions.
await shot(`<div style="padding:40px 48px;box-sizing:border-box;width:100%;height:100%">${logo}</div>`, 1200, 336, "public/brand/scopeflow-logo.png");
await shot(`<div style="width:100%;height:100%">${logo}</div>`, 1848, 374, "brand/scopeflow-logo-transparent.png", true);
await browser.close();
