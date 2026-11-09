import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — plain ESM script
import { lightenHead, pageHtml } from "../../scripts/prerender.mjs";
import { HERO, heroPreloads, heroSrcSet } from "@/lib/hero";

const TEMPLATE = `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="old" />
    <title>Old</title>
    <meta property="og:title" content="old" />
    <meta property="og:description" content="old" />
    <meta property="og:url" content="https://scopeflow.in/" />
    <meta property="og:image" content="old" />
    <script type="module" crossorigin src="/assets/index-AAA.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-1.js">
    <link rel="modulepreload" crossorigin href="/assets/site-2.js">
    <link rel="modulepreload" crossorigin href="/assets/supabase-3.js">
    <link rel="modulepreload" crossorigin href="/assets/blog-4.js">
    <link rel="modulepreload" crossorigin href="/assets/pricing-5.js">
    <link rel="modulepreload" crossorigin href="/assets/app-shell-6.js">
    <link rel="modulepreload" crossorigin href="/assets/not-found-7.js">
    <link rel="stylesheet" crossorigin href="/assets/index-BBB.css">
  </head><body><div id="root"></div></body></html>`;
const preloaded = (html: string) => [...html.matchAll(/rel="modulepreload"[^>]*href="\/assets\/([a-z-]+)-/g)].map((m) => m[1]);
const page = (path: string, extra: Record<string, unknown> = {}) =>
  pageHtml(TEMPLATE, { path, seo: { title: "T", description: "D" }, body: "<h1>x</h1>", state: null, jsonLd: {}, fonts: [], canonical: `https://scopeflow.in${path}`, ogImage: "o", ...extra }) as string;

describe("T2-10 public pages don't fetch the app's code ahead of what's on screen", () => {
  it("legal pages keep the entry script but stop preloading the app, blog and pricing chunks", () => {
    const html = page("/terms");
    expect(preloaded(html)).toEqual(["rolldown-runtime", "site"]);
    expect(html).toContain('<script type="module" crossorigin src="/assets/index-AAA.js"></script>');
    expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/index-BBB.css">');
    expect(html).not.toContain("boot.js");
  });
  it("the pricing page keeps its own chunk", () => {
    expect(preloaded(page("/pricing"))).toEqual(["rolldown-runtime", "site", "pricing"]);
  });
  it("the home page preloads its hero first and starts the app after it (boot.js)", () => {
    const html = page("/", { heroPreloads: heroPreloads() });
    expect(preloaded(html)).toEqual([]);
    expect(html).not.toContain('<script type="module"');
    expect(html).toContain('<script defer src="/boot.js" data-entry="/assets/index-AAA.js"></script>');
    // The image is announced before the stylesheet and everything else.
    expect(html.indexOf(HERO.mobile.src)).toBeGreaterThan(html.indexOf('name="viewport"'));
    expect(html.indexOf(HERO.mobile.src)).toBeLessThan(html.indexOf("index-BBB.css"));
    expect(html).toContain(`<link rel="preload" as="image" href="/home/hero-stamp-m-683.webp" media="(max-width: 639.98px)" fetchpriority="high" />`);
    expect(html).toContain(`imagesrcset="${heroSrcSet}"`);
    expect(html).toContain('media="(min-width: 640px)"');
  });
  it("the app shell (index.html) is left as built", () => {
    expect(lightenHead(TEMPLATE, { path: "/terms" })).not.toBe(TEMPLATE);
    expect(readFileSync("scripts/prerender.mjs", "utf8")).toContain('heroPreloads: path === "/" ? mod.heroPreloads() : []');
  });
  it("phones get the square the card shows: same picture, under half the bytes", () => {
    const mobile = `public${HERO.mobile.src}`;
    expect(existsSync(mobile)).toBe(true);
    expect(statSync(mobile).size).toBeLessThan(statSync("public/home/hero-stamp-1024.webp").size / 2);
    const landing = readFileSync("src/routes/landing.tsx", "utf8");
    expect(landing).toContain("<source media={HERO.mobile.media} srcSet={HERO.mobile.src} width={HERO.mobile.size} height={HERO.mobile.size} />");
    // The square card below 640px, the wide photo from 640px: the same breakpoint as the layout.
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.hm-hero-card \{\s+aspect-ratio: 1 \/ 1;\s+\}\s+@media \(min-width: 640px\) \{\s+\.hm-hero-card \{\s+aspect-ratio: 3 \/ 2;/);
    expect(HERO.mobile.media).toBe("(max-width: 639.98px)");
  });
  it("boot.js starts the app from the same origin only, after the hero and a painted frame, and never waits long", () => {
    const boot = readFileSync("public/boot.js", "utf8");
    expect(boot).toContain('document.querySelector(\'img[fetchpriority="high"]\')');
    expect(boot).toContain('hero.addEventListener("load", start, { once: true })');
    expect(boot).toContain("setTimeout(start, 2500)");
    expect(boot).toContain("requestAnimationFrame");
    expect(boot).not.toMatch(/https?:\/\//);
  });
});
