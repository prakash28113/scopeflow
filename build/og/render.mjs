// Renders public/og.png (1200×630 link-preview image) from build/og/og.html. Run: node build/og/render.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = new URL("../../", import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(new URL("build/og/og.html", root).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL("public/og.png", root).pathname });
await browser.close();
console.log("wrote public/og.png");
