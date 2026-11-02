// Page-switch speed with realistic network delay: every database request is held for LATENCY ms
// (India to a distant region), every app file for ASSET_MS. Prints the time from a click to the
// new page's content, for each main page, twice (first visit, then a return visit).
// Run: E2E_SCRIPT=perf.mjs POSTGREST_BIN=… bash tests/e2e/run.sh
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const LATENCY = Number(process.env.LATENCY ?? 250);
const ASSET_MS = Number(process.env.ASSET_MS ?? 60);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.route("https://accounts.google.com/**", (r) => r.abort());
const p = await ctx.newPage();
let dbRequests = 0;

// Sign up and create one project with no delay, then add the delays.
await p.goto(`${BASE}/signup`);
await p.getByLabel("Your name").fill("Perf Tester");
await p.getByLabel("Email").fill(`perf${Date.now()}@studio.test`);
await p.getByLabel("Password").fill("correct-horse-9");
await p.getByRole("button", { name: "Create account" }).click();
await p.waitForURL("**/onboarding");
await p.getByLabel("Your name").fill("Perf Tester");
await p.getByRole("button", { name: "Continue" }).click();
await p.waitForURL("**/projects/new?welcome=1");
await p.getByLabel("Project title").fill("Speed test project");
await p.getByLabel("Client name").fill("Dana");
await p.getByLabel("Client email").fill("dana@speed.test");
await p.getByLabel("Deliverable 1", { exact: true }).fill("Logo");
await p.getByLabel("Agreed budget").fill("1000");
await p.getByRole("button", { name: "Create project" }).click();
await p.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
const projectPath = new URL(p.url()).pathname;

await ctx.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.includes(":54321/")) {
    dbRequests++;
    await new Promise((r) => setTimeout(r, LATENCY));
  } else if (url.includes("/assets/")) {
    await new Promise((r) => setTimeout(r, ASSET_MS));
  }
  await route.continue();
});

// A fresh load of the overview (like opening the app), then switch pages from the sidebar.
await p.goto(`${BASE}/dashboard`);
await p.getByRole("heading", { name: /^Hello/ }).waitFor();
await p.waitForTimeout(1500); // the app is open; anything it does in the background happens now

const pages = [
  ["Projects", "Projects", /\/projects$/],
  ["Clients", "Clients", /\/clients$/],
  ["Invoices", "Invoices", /\/invoices$/],
  ["Analytics", "Analytics", /\/analytics$/],
  ["Approvals", "Approvals", /\/approvals$/],
  ["Overview", /^Hello/, /\/dashboard$/],
];
const results = [];
for (const round of ["first visit", "return visit"]) {
  for (const [link, heading] of pages) {
    const before = dbRequests;
    const t0 = Date.now();
    await p.locator("aside").getByRole("link", { name: link, exact: true }).click();
    await p.getByRole("heading", { level: 1, name: heading }).waitFor();
    // Content, not a loading placeholder.
    await p.waitForFunction(() => !document.querySelector('[role=status][aria-label="Loading"]'));
    results.push({ round, page: link, ms: Date.now() - t0, waitedForDb: dbRequests - before });
  }
  // The project page, from the projects list.
  await p.locator("aside").getByRole("link", { name: "Projects", exact: true }).click();
  await p.getByRole("heading", { level: 1, name: "Projects" }).waitFor();
  const before = dbRequests;
  const t0 = Date.now();
  await p.getByRole("link", { name: /Speed test project/ }).first().click();
  await p.getByRole("heading", { level: 1, name: "Speed test project" }).waitFor();
  await p.waitForFunction(() => !document.querySelector('[role=status][aria-label="Loading"]'));
  results.push({ round, page: "Project page", ms: Date.now() - t0, waitedForDb: dbRequests - before });
}
console.log(`\nPage switch times with ${LATENCY} ms per database request and ${ASSET_MS} ms per app file:`);
for (const r of results) console.log(`  ${r.round.padEnd(13)} ${r.page.padEnd(13)} ${String(r.ms).padStart(5)} ms   (${r.waitedForDb} database requests)`);
const avg = (xs) => Math.round(xs.reduce((s, x) => s + x.ms, 0) / xs.length);
console.log(`  average: first visit ${avg(results.filter((r) => r.round === "first visit"))} ms, return visit ${avg(results.filter((r) => r.round === "return visit"))} ms`);
console.log(`PERF_JSON ${JSON.stringify(results)}`);
void projectPath;
await browser.close();
