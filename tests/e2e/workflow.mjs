// End-to-end: drives the built app (served by Cloudflare's runtime via `wrangler dev`)
// in Chrome through the full ScopeFlow workflow, as freelancer (desktop) and client (phone).
// Usage: BASE=http://localhost:3000 CHROME_PATH=/path/to/chrome node tests/e2e/workflow.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox"],
});

/** Every test browser gets a stand-in for Google's sign-in script, so nothing ever contacts Google. */
const GOOGLE_STUB = `window.google={accounts:{id:{initialize(o){window.__gsi=o},renderButton(el){const b=document.createElement("button");b.type="button";b.textContent="Continue with Google";b.dataset.testid="google-stub";b.onclick=()=>window.__gsi.callback({credential:"test-google:meera@studio.test:Meera Iyer"});el.appendChild(b)}}}};`;
async function newCtx(opts = {}) {
  const c = await browser.newContext(opts);
  await c.route("https://accounts.google.com/**", (route) =>
    route.request().url().startsWith("https://accounts.google.com/gsi/client")
      ? route.fulfill({ contentType: "text/javascript", body: GOOGLE_STUB })
      : route.abort(),
  );
  return c;
}
const desk = await newCtx({ viewport: { width: 1360, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const phone = await newCtx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const f = await desk.newPage();
const c = await phone.newPage();
const errors = [];
for (const [who, p] of [["freelancer", f], ["client", c]]) {
  p.on("pageerror", (e) => errors.push(`${who} pageerror: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${who} console: ${m.text()}`);
  });
}
const shot = (p, name, full = true) => p.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
const step = (s) => console.log(`• ${s}`);
/** Taps "Download PDF" and checks a real, multi-kilobyte PDF arrives with the expected name. */
async function pdfDownload(p, button, nameRe) {
  const [download] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), button.click()]);
  assert.match(download.suggestedFilename(), nameRe);
  const file = await download.path();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length > 15_000, `PDF too small: ${bytes.length} bytes`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${OUT}${download.suggestedFilename()}`, bytes); // kept with the screenshots for review
  return bytes;
}
/** The PDF's text layer (where poppler's pdftotext is installed; otherwise null and text checks are skipped). */
async function pdfText(bytes) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("pdftotext", ["-", "-"], { input: bytes });
  return r.status === 0 ? r.stdout.toString() : null;
}
const IN_14_DAYS = (() => { const d = new Date(Date.now() + 14 * 86_400_000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); })();
const longDate = (iso) => new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
/** Confirms the in-app dialog that destructive actions open. */
const confirmDialog = (p) => p.getByRole("alertdialog").getByRole("button").last().click();
const SOON = (() => { const d = new Date(Date.now() + 3 * 86_400_000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); })();

try {
  // ---------------------------------------------------------- freelancer onboarding
  step("landing + sign up (no email confirmation)");
  await f.goto(BASE);
  await f.getByRole("heading", { name: "Get paid for every “just one small change”." }).waitFor();
  assert.equal(await f.getByTestId("hero-subline").innerText(), "Every client job, on the record.");
  // Footer: who built it, how to reach us.
  assert.equal(await f.getByTestId("built-by").innerText(), "Built in Hyderabad by Prakash Mummidisetti");
  assert.equal(await f.getByRole("link", { name: "Instagram" }).getAttribute("href"), "https://www.instagram.com/scope_flow_official/");
  await f.getByRole("link", { name: "support@scopeflow.in" }).waitFor();
  await f.getByText("Fresh guides for Indian freelancers every week").waitFor();
  await f.getByRole("link", { name: "Start free" }).first().waitFor();
  assert.equal(await f.locator(".lp-row").count(), 7); // the example job record
  // The app preview is a picture of the product: built from the app's components, not focusable.
  assert.equal(await f.locator(".lp-app[inert]").count(), 1);
  await f.getByText("Does ScopeFlow take payments?").click();
  await f.getByText("It records the payments you receive.").waitFor();
  {
    // The home page on a phone: readable, nothing sideways.
    const lp = await phone.newPage();
    await lp.goto(BASE);
    await lp.getByRole("heading", { name: "Get paid for every “just one small change”." }).waitFor();
    // Pricing stays in the header on a phone.
    assert.ok(await lp.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).isVisible(), "Pricing link visible on a phone");
    assert.equal(await lp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || window.innerWidth > 390), false, "home page scrolls sideways on a phone");
    await lp.waitForTimeout(3500); // let the record finish writing in
    // Sections appear as they scroll into view: scroll through once, like a visitor would.
    // (The page grows as sections are drawn, so keep going until the real bottom.)
    for (let y = 0; y < (await lp.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
      await lp.evaluate((yy) => window.scrollTo(0, yy), y);
      await lp.waitForTimeout(80);
    }
    await lp.waitForTimeout(1200);
    assert.equal(await lp.locator("[data-reveal]:not([data-in])").count(), 0, "every section has been revealed");
    await lp.evaluate(() => window.scrollTo(0, 0));
    await shot(lp, "00-landing-mobile");
    await lp.close();
  }
  {
    // The full wordmark, Pricing and Start free on one row from 320px up, on every public header.
    for (const width of [320, 360, 375, 412]) {
      const ctx = await newCtx({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true });
      const pg = await ctx.newPage();
      for (const path of ["/", "/pricing", "/terms", "/blog"]) {
        await pg.goto(BASE + path);
        const header = pg.getByTestId("public-header").first();
        await header.waitFor();
        const logo = await header.getByRole("link", { name: "ScopeFlow home" }).locator("svg").first().boundingBox();
        assert.ok(logo && logo.width > 90, `${path} at ${width}px shows the wordmark (logo ${logo?.width}px wide)`);
        for (const name of ["Pricing", "Start free"]) assert.ok(await header.getByRole("link", { name, exact: true }).isVisible(), `${path} at ${width}px shows ${name}`);
        const boxes = await Promise.all(["Pricing", "Start free"].map((name) => header.getByRole("link", { name, exact: true }).boundingBox()));
        assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 12 && boxes[1].x + boxes[1].width <= width, `${path} at ${width}px: one row, inside the screen`);
        assert.ok(logo.x + logo.width + 6 <= boxes[0].x, `${path} at ${width}px: the wordmark doesn't touch Pricing`);
        assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${path} at ${width}px scrolls sideways`);
      }
      if (width === 320) await shot(pg, "00-header-320", false);
      await ctx.close();
    }
  }
  await f.getByRole("link", { name: "Privacy" }).click();
  await f.getByRole("heading", { name: "Privacy Policy" }).waitFor();
  await f.goto(`${BASE}/terms`);
  await f.getByRole("heading", { name: "Terms & Conditions" }).waitFor();
  await f.getByText("courts at Hyderabad, Telangana").waitFor();
  // Public pricing page (signed out): plans come from the database.
  await f.goto(`${BASE}/pricing`);
  await f.getByRole("heading", { name: /Simple pricing/ }).waitFor();
  await f.getByText("Recommended").waitFor();
  // Opens on monthly prices; yearly is one tap away.
  assert.equal(await f.getByRole("radio", { name: "Monthly" }).getAttribute("aria-checked"), "true");
  await f.getByText("₹499").first().waitFor();
  await f.getByRole("radio", { name: /Yearly/ }).click();
  await f.getByText("₹4,999").waitFor();
  await f.getByRole("radio", { name: "Monthly" }).click();
  await f.getByText("₹499").first().waitFor();
  await f.getByText("Not on sale yet — no payment taken.").first().waitFor();
  await shot(f, "00-pricing", false);

  step("search engines: public pages arrive prerendered, with their own title, canonical address and structured data");
  {
    const raw = async (path, status = 200) => {
      const res = await fetch(BASE + path, { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } });
      assert.equal(res.status, status, `${path} status`);
      return res.text();
    };
    const pages = {
      "/": ["Get paid for every “just one small change”.", "Every client job, on the record.", "Does ScopeFlow take payments?", "Built in Hyderabad by Prakash Mummidisetti"],
      "/pricing": ["Simple pricing.", "₹499"], // plans fetched at build time
      "/refunds": ["Refund and cancellation policy", "within 7 days"],
      "/contact": ["Contact us", "Hyderabad, Telangana"],
      "/privacy": ["Privacy Policy"],
      "/terms": ["Terms &amp; Conditions", "Hyderabad, Telangana"],
    };
    const titles = new Set();
    for (const [path, texts] of Object.entries(pages)) {
      const html = await raw(path);
      assert.ok(html.includes(`data-page="${path}"`), `${path} is prerendered`);
      for (const t of texts) assert.ok(html.includes(t), `${path} HTML contains "${t}"`);
      const url = path === "/" ? "https://scopeflow.in/" : `https://scopeflow.in${path}`;
      assert.ok(html.includes(`<link rel="canonical" href="${url}" />`), `${path} canonical`);
      assert.ok(!/name="robots"[^>]*noindex/.test(html), `${path} must be indexable`);
      const title = html.match(/<title>([^<]+)<\/title>/)[1];
      assert.ok(!titles.has(title), `${path} has its own title`);
      titles.add(title);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)[1]);
      assert.ok(ld["@graph"].some((n) => n["@type"] === "Organization" && n.name === "ScopeFlow"), `${path} structured data`);
    }
    // The app's pages and unknown addresses get the plain shell, never the home page's content.
    for (const path of ["/dashboard", "/p"]) assert.ok((await raw(path)).includes('<div id="root"></div>'), `${path} gets the app shell`);
    // Unknown addresses: a real 404 (not a "soft 404"), still the app's helpful page, never indexed.
    for (const path of ["/no-such-page", "/projects/a/b/c", "/blog/a/b"]) {
      const res = await fetch(BASE + path, { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } });
      assert.equal(res.status, 404, `${path} status`);
      assert.equal(res.headers.get("x-robots-tag"), "noindex");
      assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
      assert.ok((await res.text()).includes('<div id="root"></div>'), `${path} gets the app shell`);
    }
    // Static files are still served as before; a missing built asset is a plain 404 that isn't cached.
    assert.equal((await fetch(`${BASE}/icon.svg`)).status, 200);
    const favicon = await fetch(`${BASE}/favicon.ico`);
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get("content-type") ?? "", /icon/);
    const oldChunk = await fetch(`${BASE}/assets/nope.js`);
    assert.equal(oldChunk.status, 404);
    assert.doesNotMatch(oldChunk.headers.get("cache-control") ?? "", /immutable/);
    const realChunk = (await raw("/")).match(/\/assets\/index-[\w-]+\.js/)[0];
    const chunk = await fetch(BASE + realChunk);
    assert.equal(chunk.status, 200);
    assert.match(chunk.headers.get("cache-control") ?? "", /immutable/);
    // Paid plans aren't on sale here: no claim of live payment on the pricing page.
    assert.ok(!(await raw("/pricing")).includes("Paid securely through Razorpay"), "no live-payment claim while nothing is on sale");
    for (const path of ["/", "/pricing"]) assert.ok(!(await raw(path)).includes("free for everyone during the beta"), `${path} FAQ matches the plans`);
    // One header everywhere: site links on the pricing and legal pages too.
    for (const path of ["/pricing", "/terms"]) {
      const header = (await raw(path)).match(/<header[\s\S]*?<\/header>/)[0];
      assert.ok(header.includes('href="/blog"') && header.includes('href="/#product"'), `${path} header has the site links`);
    }
    assert.equal((await fetch(`${BASE}/missing-file.png`)).status, 404);
    // Plan prices in rupees in the pricing page's structured data.
    const pricingLd = (await raw("/pricing")).match(/<script type="application\/ld\+json">(.+?)<\/script>/)[1];
    assert.ok(pricingLd.includes('"priceCurrency":"INR"') && !pricingLd.includes("USD"), "pricing offers in INR");
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    for (const path of Object.keys(pages)) assert.ok(sitemap.includes(`<loc>https://scopeflow.in${path === "/" ? "/" : path}</loc>`), `sitemap lists ${path}`);
    assert.match(await (await fetch(`${BASE}/robots.txt`)).text(), /Sitemap: https:\/\/scopeflow\.in\/sitemap\.xml/);

    // In the browser, React adopts the prerendered markup (no flash, no re-render) and the page works.
    const hp = await desk.newPage();
    const hErrors = [];
    hp.on("pageerror", (e) => hErrors.push(e.message));
    hp.on("console", (m) => m.type() === "error" && hErrors.push(m.text()));
    await hp.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const root = document.getElementById("root");
        window.__sfFirst = root.firstElementChild;
      });
    });
    for (const path of Object.keys(pages)) {
      await hp.goto(BASE + path, { waitUntil: "networkidle" });
      assert.equal(await hp.evaluate(() => document.getElementById("root").firstElementChild === window.__sfFirst), true, `${path} was hydrated, not re-rendered`);
    }
    await hp.goto(BASE + "/", { waitUntil: "networkidle" });
    await hp.getByRole("link", { name: "Pricing" }).first().click();
    await hp.getByRole("heading", { name: /Simple pricing/ }).waitFor();
    assert.equal(await hp.title(), "Pricing: free for 2 active projects | ScopeFlow", "title follows in-app navigation");
    assert.equal(await hp.locator('link[rel="canonical"]').getAttribute("href"), "https://scopeflow.in/pricing");
    await hp.goto(`${BASE}/no-such-page`);
    await hp.getByRole("heading", { name: "Page not found" }).waitFor();
    await hp.getByRole("link", { name: "Go to home" }).waitFor(); // visitors get the home page, blog and pricing
    await hp.getByRole("link", { name: "Read the blog" }).waitFor();
    // The browser reports the page's own 404 status in the console; that's expected here.
    for (let i = hErrors.length - 1; i >= 0; i--) if (/status of 404/.test(hErrors[i])) hErrors.splice(i, 1);
    assert.equal(await hp.locator('meta[name="robots"]').getAttribute("content"), "noindex");
    assert.deepEqual(hErrors, [], "no hydration or console errors on the public pages");
    await hp.close();
  }
  await f.goto(BASE);
  await shot(f, "01-landing", false);
  await f.goto(`${BASE}/signup`);
  await f.getByRole("button", { name: "Create account" }).click();
  await f.getByText("Enter a valid email").waitFor();
  await f.getByLabel("Your name").fill("Priya Raman");
  await f.getByLabel("Email").fill("priya@studio.test");
  await f.getByLabel("Password").fill("correct-horse-9");
  await f.getByRole("button", { name: "Create account" }).click();
  await f.waitForURL("**/onboarding");

  step("onboarding");
  await f.getByLabel("Your name").fill("");
  await f.getByRole("button", { name: "Continue" }).click();
  await f.getByText("Name is required").waitFor();
  await f.getByLabel("Your name").fill("Priya Raman");
  await f.getByLabel("Business or studio name").fill("Raman Studio");
  await f.getByLabel("Default currency").selectOption("USD");
  await shot(f, "02-onboarding", false);
  await f.getByRole("button", { name: "Continue" }).click();
  await f.waitForURL("**/projects/new?welcome=1");

  // ---------------------------------------------------------- AI: describe → suggested scope (mock provider)
  step("AI scope suggestion: describe, review, untick, use in the form (nothing saved)");
  const aiPanel = f.getByTestId("ai-scope-draft");
  await aiPanel.waitFor();
  assert.equal(await aiPanel.getByRole("button", { name: "Suggest a scope" }).isDisabled(), true);
  await f.getByLabel("What are you making, for whom, and for how much?").fill("Brand kit for Chai & Co.: logo ₹25,000, palette, menu card. Budget 40k.");
  await aiPanel.getByRole("button", { name: "Suggest a scope" }).click();
  const review = f.getByTestId("ai-draft-review");
  await review.waitFor();
  await review.getByText("Brand kit for Chai & Co.").waitFor();
  // The invented price on the palette (mock says 99,999) never reaches the screen; it's asked for instead.
  assert.equal(await review.getByText(/99,999/).count(), 0);
  await f.getByTestId("ai-questions").getByText("What is the price for “Colour palette and type”?").waitFor();
  await aiPanel.getByText(/29 suggestions left today/).waitFor();
  await review.getByLabel(/Photography/).uncheck();
  await shot(f, "03a-ai-suggestion");
  await review.getByRole("button", { name: "Use in the form" }).click();
  await review.getByText("Added to the form below.").waitFor();
  assert.equal(await f.getByLabel("Project title").inputValue(), "Brand kit for Chai & Co.");
  assert.equal(await f.getByLabel("Client name").inputValue(), "Chai & Co.");
  assert.equal(await f.getByLabel("Deliverable 1", { exact: true }).inputValue(), "Primary logo");
  assert.equal(await f.getByLabel("Agreed budget").inputValue(), "40000");
  assert.equal(await f.getByLabel("Not included").inputValue(), "Printing costs\nCopywriting");
  assert.match(await f.locator("#terms").inputValue(), /This quote assumes:/);
  assert.equal(await f.locator("#m-amt-0").inputValue(), "20000");
  // A bad session is refused by the AI endpoint, before any model call.
  assert.equal(await f.evaluate(async () => (await fetch("/api/ai/status", { headers: { authorization: "Bearer bad" } })).status), 401);
  await f.goto(`${BASE}/projects/new?welcome=1`);
  await f.getByTestId("ai-scope-draft").waitFor();

  // ---------------------------------------------------------- create project
  step("project form validation + create");
  await f.getByRole("button", { name: "Create project" }).click();
  await f.getByText("Please fix the highlighted fields.").waitFor();
  await f.getByLabel("Project title").fill("Brand identity for Northwind Coffee");
  await f.getByLabel("Client name").fill("Dana Whitfield");
  await f.getByLabel("Client email").fill("dana@northwind.test");
  await f.getByLabel("Company").fill("Northwind Coffee");
  await f.getByLabel("Summary").fill("A complete visual identity for the new roastery: primary logo, colour palette and a compact brand guide.");
  await f.getByLabel("Deliverable 1", { exact: true }).fill("Primary logo");
  await f.locator("#d-rev-0").fill("2");
  await f.locator("#d-due-0").fill("2026-11-20");
  await f.getByRole("button", { name: "Add deliverable" }).click();
  await f.getByLabel("Deliverable 2", { exact: true }).fill("Brand guidelines (12 pages)");
  await f.locator("#d-rev-1").fill("1");
  await f.getByLabel("Agreed budget").fill("3200");
  await f.getByLabel("Start date").fill("2026-11-02");
  await f.getByLabel("Due date").fill("2026-11-27");
  await f.getByRole("button", { name: "Add milestone" }).click();
  await f.getByLabel("Milestone 1").fill("50% deposit");
  await f.locator("#m-amt-0").fill("1600");
  await f.locator("#m-due-0").fill(SOON);
  await f.getByRole("button", { name: "Add milestone" }).click();
  await f.getByLabel("Milestone 2").fill("Final delivery");
  await f.locator("#m-amt-1").fill("1600");
  await f.locator("#m-due-1").fill("2026-11-27");
  await f.getByText("Scheduled $3,200.00 of $3,200.00").waitFor();
  // v1.1 scope checker: flags missing exclusions, then goes quiet about them once added.
  await f.getByText(/Add what's not included/).waitFor();
  await f.getByLabel("Not included").fill("Copywriting\nStock photo licences\nPrinting");
  await f.getByLabel("Price per extra revision round (USD)").fill("150");
  await f.getByLabel("Terms").fill("50% deposit before work starts. Final files after full payment.");
  await f.getByText(/Add what's not included/).waitFor({ state: "detached" });
  await shot(f, "03-new-project");
  await f.getByRole("button", { name: "Create project" }).click();
  await f.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = f.url();
  await f.getByText("A link is created when you send the scope.").waitFor();
  await shot(f, "04-project-draft");

  // ---------------------------------------------------------- send scope → link shown once
  step("send scope v1 → one-time link dialog");
  await f.getByRole("button", { name: "Send to client" }).click();
  await f.getByRole("heading", { name: "Client link ready" }).waitFor();
  const portalUrl = await f.getByTestId("share-url").innerText();
  assert.match(portalUrl, new RegExp(`^${BASE}/p#[A-Za-z0-9_-]{43}$`));
  await shot(f, "05-share-dialog", false);
  await f.getByRole("button", { name: "Copy link" }).click();
  assert.equal(await f.evaluate(() => navigator.clipboard.readText()), portalUrl);
  await f.getByRole("button", { name: "Done", exact: true }).click();
  await f.getByText(/Active · works until/).waitFor();
  // The full link must be gone from the page once the dialog closes.
  await f.getByTestId("share-url").waitFor({ state: "detached", timeout: 5000 });
  assert.equal(await f.getByText(portalUrl).count(), 0);

  // ---------------------------------------------------------- client rejects v1
  step("client (phone) requests changes");
  await c.goto(portalUrl);
  await c.getByText("Please review the scope below").waitFor();
  await c.getByRole("heading", { name: "Not included" }).waitFor();
  await c.getByText("Stock photo licences").waitFor();
  await c.getByText(/Due Nov 20, 2026/).first().waitFor(); // deliverable due date, part of what the client approves
  await c.getByText("Each extra revision round").waitFor();
  await c.getByText("$150.00").first().waitFor();
  await c.getByText("50% deposit before work starts. Final files after full payment.").waitFor();
  await shot(c, "06-portal-review-mobile");
  await c.getByRole("radio", { name: "Request changes" }).click();
  await c.getByRole("button", { name: "Send feedback" }).click();
  await c.getByText("Tell your freelancer what needs to change").waitFor();
  await c.getByLabel("What should change?").fill("Could you add a favicon set? We need it for the web shop.");
  await c.getByRole("button", { name: "Send feedback" }).click();
  await c.getByText(/Thanks for your feedback on/).waitFor();

  step("freelancer sees notification, revises, resends (existing link reused)");
  await f.reload();
  // "Opened" (v1.1 timeline) + "asked for changes".
  await f.getByRole("link", { name: /Notifications, 2 unread/ }).waitFor({ timeout: 15000 });
  await f.getByText(/Opened by client/).first().waitFor();
  await f.getByText("asked for changes").waitFor();
  await f.getByRole("link", { name: "Edit scope" }).click();
  await f.getByRole("button", { name: "Add deliverable" }).click();
  await f.getByLabel("Deliverable 3", { exact: true }).fill("Favicon set");
  await f.locator("#d-rev-2").fill("1");
  await f.getByRole("button", { name: "Save changes" }).click();
  await f.getByText("Scope updated.").waitFor();
  await f.getByRole("button", { name: "Send revised scope" }).click();
  await f.getByText(/Scope v2 sent\. Dana Whitfield's existing link now shows the new version\./).waitFor();

  // ---------------------------------------------------------- client approves v2
  step("client approves v2");
  await c.reload();
  await c.getByText("This is version 2").waitFor();
  assert.ok(await c.getByText("Favicon set").isVisible());
  await c.getByRole("button", { name: "Approve scope" }).last().click();
  await c.getByText("Please confirm you approve this scope").waitFor();
  await c.getByRole("checkbox").check();
  await shot(c, "07-portal-approve-mobile");
  await c.getByRole("button", { name: "Approve scope" }).last().click();
  await c.getByText("Request a change").waitFor();
  await c.getByText(/approved by Dana Whitfield/).waitFor();
  await c.getByText("0 of 2 used · 2 left").waitFor();

  step("dashboard shows upcoming payment dates");
  await f.goto(`${BASE}/dashboard`);
  assert.match(await f.getByTestId("feedback-link").getAttribute("href"), /^mailto:.+\?subject=ScopeFlow%20feedback&body=.*Page%3A%20%2Fdashboard/);
  await f.getByTestId("upcoming").getByText("50% deposit", { exact: true }).waitFor();
  await f.getByTestId("upcoming").getByText("Payment for Brand identity for Northwind Coffee").waitFor();
  await f.getByText(/^In 3 days/).waitFor();
  // The workspace assistant answers from the freelancer's own data (mock provider here).
  const dashAsk = f.getByTestId("ai-assistant");
  await dashAsk.getByRole("button", { name: "Who owes me money?" }).click();
  await dashAsk.getByTestId("ai-answer").getByText("1 payment due").waitFor();

  // ---------------------------------------------------------- revisions + scope check
  step("client requests revisions — third exceeds the limit");
  async function request(kind, deliverable, text) {
    if (kind === "new") await c.getByRole("radio", { name: "Something new" }).click();
    else {
      await c.getByRole("radio", { name: "Revise a deliverable" }).click();
      await c.getByLabel("Deliverable", { exact: true }).selectOption({ label: deliverable });
    }
    await c.getByLabel("Describe the change").fill(text);
    await c.getByRole("button", { name: "Send request" }).click();
    const msg = await c.getByText(/^Request sent\./).innerText();
    await c.getByRole("button", { name: "New request" }).click();
    return msg;
  }
  assert.match(await request("rev", "Primary logo", "Make the wordmark a little bolder."), /covered by the revisions included/);
  assert.match(await request("rev", "Primary logo", "Try the navy from the palette."), /covered/);
  await c.getByRole("radio", { name: "Revise a deliverable" }).click();
  await c.getByLabel("Deliverable", { exact: true }).selectOption({ label: "Primary logo" });
  await c.getByText("All included revisions are used. An extra round is $150.00").waitFor();
  assert.match(await request("rev", "Primary logo", "One more round with a rounder cup icon."), /beyond the agreed scope/);
  await c.getByText("All 2 used · 1 extra").waitFor();
  assert.match(await request("new", null, "We'd also like a loyalty card design."), /beyond the agreed scope/);

  step("freelancer proposes an hourly change order");
  await f.goto(projectUrl);
  await f.getByText("2 requests from your client fall outside the approved scope").waitFor();
  assert.equal(await f.getByText("In scope · 1 of 2").count(), 1);
  assert.equal(await f.getByText("Over revision limit").count(), 1);
  assert.equal(await f.getByText("Outside original scope").count(), 1);
  await shot(f, "08-project-requests");

  step("AI: check a request against the scope, draft the change order; ask about the project (mock provider)");
  const loyalty = f.locator("li", { hasText: "We'd also like a loyalty card design." });
  await loyalty.getByTestId("ai-impact-open").click();
  const impact = loyalty.getByTestId("ai-impact");
  assert.equal(await impact.getByLabel("What the client asked for").inputValue(), "We'd also like a loyalty card design.");
  await impact.getByRole("button", { name: "Check impact" }).click();
  const impactResult = impact.getByTestId("ai-impact-result");
  await impactResult.getByText("New work: needs a change order").waitFor();
  await impactResult.getByText("Set a price").waitFor();
  await impactResult.getByTestId("ai-client-message").waitFor();
  await shot(f, "08a-ai-impact");
  await impactResult.getByRole("button", { name: "Draft change order" }).click();
  await f.waitForURL(/change-orders\/new\?request=/);
  assert.equal(await f.getByLabel("Title").inputValue(), "Extra item");
  assert.match(await f.getByLabel("Description").inputValue(), /isn't in the approved scope/);
  await f.getByText("Filled in from the scope check.").waitFor();
  await f.goto(projectUrl);
  const ask = f.getByTestId("ai-assistant");
  await ask.getByRole("button", { name: "Summarize the status" }).click();
  await ask.getByTestId("ai-answer").getByText("Here is where things stand.").waitFor();
  await ask.getByText("1 approval waiting").waitFor();
  // Follow-up question in the same box.
  await ask.getByLabel("Ask about this project…").fill("And what should I do next?");
  await ask.getByRole("button", { name: "Ask" }).click();
  await f.waitForFunction(() => document.querySelectorAll('[data-testid="ai-answer"]').length === 2);
  await shot(f, "08b-ai-assistant");
  await f.goto(projectUrl);
  // The agreed extra-round price pre-fills the change order for an over-limit revision.
  await f.getByRole("link", { name: "Charge extra round · $150.00" }).click();
  await f.waitForURL(/change-orders\/new\?request=/);
  assert.equal(await f.getByLabel("Price (USD)").inputValue(), "150.00");
  await f.goto(projectUrl);
  await f.getByRole("link", { name: "Propose change order" }).first().click();
  await f.waitForURL(/change-orders\/new\?request=/);
  await f.getByLabel("Title").fill("Loyalty card design");
  await f.getByRole("radio", { name: "Hourly" }).click();
  await f.getByLabel("Hours").fill("6.5");
  await f.getByLabel("Hourly rate (USD)").fill("85");
  await f.getByLabel("Additional days").fill("3");
  await f.getByText("$552.50").first().waitFor();
  await f.getByText("+17.3%").waitFor();
  await f.getByText("Nov 30").waitFor();
  await shot(f, "09-change-order");
  await f.getByRole("button", { name: "Send for approval" }).click();
  await f.getByText(/Change order sent/).waitFor();

  step("client approves the change order");
  await c.reload();
  await c.getByText("Change order #1: Loyalty card design").waitFor();
  await shot(c, "10-portal-change-order-mobile");
  await c.getByRole("button", { name: "Approve", exact: true }).click();
  await c.getByRole("button", { name: "Confirm approval" }).click();
  await c.getByText(/Approved by Dana Whitfield/).waitFor();
  await c.getByText("$3,752.50").first().waitFor();

  // ---------------------------------------------------------- payments
  step("freelancer records a payment");
  await f.goto(projectUrl);
  await f.getByText("Change order #1: Loyalty card design").first().waitFor();
  await f.getByRole("button", { name: "Record payment" }).first().click();
  const rp = f.getByTestId("record-payment");
  assert.equal(await rp.getByLabel("Amount (USD)").inputValue(), "1600.00");
  await rp.getByLabel("Method").selectOption("bank_transfer");
  await rp.getByLabel("Reference (optional)").fill("Wise transfer #4471");
  await rp.getByRole("button", { name: "Save payment" }).click();
  await f.getByText("Payment recorded.").waitFor();
  await f.getByTestId("payment-records").getByText(/Bank transfer · Wise transfer #4471/).waitFor();
  await f.getByText(/Paid in full/).first().waitFor();
  const totals = await f.getByTestId("payment-totals").innerText();
  assert.match(totals, /\$3,752\.50/);
  assert.match(totals, /\$1,600\.00/);
  assert.match(totals, /\$2,152\.50/);
  await shot(f, "11-project-active");

  step("in-app notifications");
  await f.goto(`${BASE}/dashboard`);
  await f.getByText("Hello, Priya").waitFor();
  await f.getByRole("link", { name: /Notifications, \d+ unread/ }).waitFor();
  await shot(f, "12-dashboard");
  await f.getByRole("link", { name: /Notifications/ }).click();
  await f.getByText("Change order #1 approved by Dana Whitfield").waitFor();
  await f.getByRole("heading", { name: /^Reminders/ }).waitFor(); // one place: reminders and client activity
  await f.getByRole("heading", { name: "Client activity" }).waitFor();
  await shot(f, "13-notifications");
  await f.getByRole("link", { name: "Notifications", exact: true }).waitFor();

  step("client sees payment + history");
  await c.reload();
  await c.getByText("Received").first().waitFor();
  await shot(c, "14-portal-active-mobile");

  // ---------------------------------------------------------- security through the app
  step("security: replaced link stops working immediately");
  await f.goto(projectUrl);
  await f.getByLabel("Link validity").selectOption("7");
  await f.getByRole("button", { name: "Replace link" }).click();
  await confirmDialog(f);
  await f.getByRole("heading", { name: "Client link ready" }).waitFor();
  const newUrl = await f.getByTestId("share-url").innerText();
  assert.notEqual(newUrl, portalUrl);
  await f.getByRole("button", { name: "Done", exact: true }).click();
  await c.goto("about:blank");
  await c.goto(portalUrl);
  await c.getByText("This link isn't working").waitFor();
  await c.goto("about:blank");
  await c.goto(newUrl);
  await c.getByText("Brand identity for Northwind Coffee").first().waitFor();

  step("security: revoke");
  await f.getByRole("button", { name: "Revoke" }).click();
  await confirmDialog(f);
  await f.getByText("No active link").waitFor();
  await c.goto("about:blank");
  await c.goto(newUrl);
  await c.getByText("This link isn't working").waitFor();

  step("security: malformed links");
  await c.goto(`${BASE}/p#not-a-token`);
  await c.getByText("This link isn't working").waitFor();
  await c.goto(`${BASE}/p`);
  await c.getByText("This link isn't working").waitFor();

  step("security: another account can't see the project");
  const intruderCtx = await newCtx();
  const intruder = await intruderCtx.newPage();
  await intruder.goto(`${BASE}/signup`);
  await intruder.getByLabel("Your name").fill("Mallory");
  await intruder.getByLabel("Email").fill("mallory@evil.test");
  await intruder.getByLabel("Password").fill("password-123");
  await intruder.getByRole("button", { name: "Create account" }).click();
  await intruder.waitForURL("**/onboarding");
  await intruder.getByRole("button", { name: "Continue" }).click();
  await intruder.waitForURL("**/projects/new**");
  await intruder.goto(projectUrl);
  await intruder.getByText("Page not found").waitFor();
  await intruder.goto(`${BASE}/dashboard`);
  await intruder.getByText("No projects yet").waitFor();

  step("security: signed-out access redirects to sign-in");
  const anonCtx = await newCtx();
  const anon = await anonCtx.newPage();
  await anon.goto(projectUrl);
  await anon.waitForURL(/\/login\?next=/);

  step("v1.2: template, itemised quote with GST, printable quote");
  // v1.2: start from a template and send an itemised quote with GST.
  await f.goto(`${BASE}/projects/new`);
  await f.getByRole("button", { name: "Graphic design" }).click();
  await f.getByText("Graphic design template applied").waitFor();
  assert.equal(await f.getByLabel("Deliverable 1", { exact: true }).inputValue(), "Concept options");
  assert.match(await f.getByLabel("Not included").inputValue(), /Copywriting/);
  assert.equal(await f.getByRole("link", { name: /UI\/UX design/ }).count(), 1); // full-library template points to plans on Free
  await f.getByLabel("Project title").fill("Menu card for Northwind");
  await f.getByLabel("Client name").fill("Dana Whitfield");
  await f.getByLabel("Client email").fill("dana@northwind.test");
  await f.getByLabel("Currency").selectOption("INR");
  await f.getByText("Price each deliverable").click();
  // Per unit: 3 options × ₹50 = ₹150.
  await f.getByRole("radio", { name: "Per unit" }).first().click();
  await f.locator("#d-qty-0").fill("3");
  await f.locator("#d-unit-0").fill("options");
  await f.locator("#d-each-0").fill("50");
  await f.getByRole("radio", { name: "Hourly" }).nth(1).click();
  await f.locator("#d-hours-1").fill("4");
  await f.locator("#d-rate-1").fill("50");
  await f.getByLabel("Tax name").fill("GST");
  await f.getByLabel("Tax %").fill("18");
  const summary = await f.getByTestId("quote-summary").innerText();
  assert.match(summary, /Subtotal\s+₹350\.00/);
  assert.match(summary, /GST\s+₹63\.00/);
  assert.match(summary, /Total\s+₹413\.00/);
  await f.getByRole("button", { name: "Add milestone" }).click();
  await f.getByLabel("Milestone 1").fill("Advance");
  await f.locator("#m-amt-0").fill("206.50");
  await f.getByLabel("Quote valid until").fill(IN_14_DAYS);
  // Save this scope as my own template, then apply it again: same quote.
  await f.getByRole("button", { name: "Save as template" }).click();
  await f.getByLabel("Template name").fill("Menu cards");
  await f.getByRole("button", { name: "Save template" }).click();
  await f.getByText(/Saved as template “Menu cards”/).waitFor();
  await f.getByTestId("saved-templates").getByRole("button", { name: "Menu cards", exact: true }).click();
  await f.getByText("Menu cards template applied").waitFor();
  assert.equal(await f.locator("#d-qty-0").inputValue(), "3");
  assert.match(await f.getByTestId("quote-summary").innerText(), /Total\s+₹413\.00/);
  await shot(f, "19-quote-builder");
  await f.getByRole("button", { name: "Create project" }).click();
  await f.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const menuUrl = f.url();
  await f.getByTestId("quote-table").waitFor();
  await f.getByRole("link", { name: "Printable quote" }).click();
  await f.waitForURL(/\/quote$/);
  await f.getByText("Prepared for").waitFor();
  assert.match(await f.getByTestId("quote-table").innerText(), /Total\s+₹413\.00/);
  assert.match(await f.getByTestId("quote-table").innerText(), /4 h × ₹50\.00/);
  assert.match(await f.getByTestId("quote-table").innerText(), /3 options × ₹50\.00/);
  await f.getByText(longDate(IN_14_DAYS)).waitFor(); // valid until
  await pdfDownload(f, f.getByRole("button", { name: "Download PDF" }), /^Quote-Menu-card-for-Northwind\.pdf$/);
  await shot(f, "20-printable-quote");

  step("launch prep: UPI payment details, WhatsApp + email sharing, client pays via UPI");
  await f.goto(`${BASE}/settings`);
  await f.getByLabel("UPI ID").fill("not a upi id");
  await f.getByRole("button", { name: "Save payment details" }).click();
  await f.getByText("Enter a UPI ID like yourname@okicici").waitFor();
  await f.getByLabel("UPI ID").fill("priya.studio@okaxis");
  await f.getByRole("button", { name: "Save payment details" }).click();
  await f.getByText("Payment details saved.").waitFor();
  await shot(f, "22-settings-upi", false);
  await f.goto(menuUrl);
  await f.getByRole("button", { name: "Send to client" }).click();
  await f.getByRole("heading", { name: "Client link ready" }).waitFor();
  const menuPortal = await f.getByTestId("share-url").innerText();
  const wa = await f.getByTestId("share-whatsapp").getAttribute("href");
  assert.ok(wa.startsWith("https://wa.me/?text="), wa);
  const waText = decodeURIComponent(wa.slice("https://wa.me/?text=".length));
  assert.ok(waText.includes(menuPortal) && waText.includes("Menu card for Northwind"), waText);
  const mail = await f.getByRole("link", { name: "Email", exact: true }).getAttribute("href");
  assert.match(mail, /^mailto:dana%40northwind\.test\?subject=/);
  await shot(f, "23-share-whatsapp", false);
  await f.getByRole("button", { name: "Done", exact: true }).click();
  await c.goto(menuPortal);
  await c.getByTestId("quote-valid-until").getByText(longDate(IN_14_DAYS)).waitFor();
  await pdfDownload(c, c.getByRole("button", { name: "Download PDF" }).first(), /^Menu-card-for-Northwind-scope-v1\.pdf$/);
  await c.getByRole("button", { name: "Approve scope" }).last().click();
  await c.getByRole("checkbox").check();
  await c.getByRole("button", { name: "Approve scope" }).last().click();
  await c.getByText(/approved by Dana Whitfield/).waitFor();
  const pay = c.getByTestId("upi-pay");
  const upi = new URL(await pay.getAttribute("href"));
  assert.equal(upi.protocol, "upi:");
  assert.equal(upi.searchParams.get("pa"), "priya.studio@okaxis");
  assert.equal(upi.searchParams.get("am"), "206.50");
  assert.equal(upi.searchParams.get("cu"), "INR");
  await c.getByRole("button", { name: "Show QR code" }).click();
  await c.getByRole("img", { name: /QR code to pay/ }).locator("svg").waitFor();
  await shot(c, "24-portal-upi-mobile");
  // One UPI button per unpaid milestone (rupee projects only; USD is covered in tests/db/upi.test.ts).
  assert.equal(await c.getByTestId("upi-pay").count(), 1);

  step("invoices: details in Settings, create a GST invoice from a payment, client sees it, list and void");
  await f.goto(`${BASE}/settings`);
  await f.getByLabel("GSTIN (optional)").fill("36ABCDE1234");
  await f.getByRole("button", { name: "Save invoice details" }).click();
  await f.getByText("Enter a valid 15-character GSTIN").waitFor();
  await f.getByLabel("Business address").fill("12 MG Road\nHyderabad 500001");
  await f.getByLabel("GSTIN (optional)").fill("36abcde1234f1z5");
  await f.getByLabel("Invoice number prefix").fill("rs");
  await f.getByRole("button", { name: "Save invoice details" }).click();
  await f.getByText("Invoice details saved.").waitFor();
  await f.goto(menuUrl);
  await f.getByRole("button", { name: "Create invoice" }).first().click();
  const form = f.getByTestId("create-invoice");
  assert.equal(await form.getByLabel("Rate %").inputValue(), "18");
  assert.equal(await form.getByLabel("Tax name").inputValue(), "GST");
  assert.equal(await form.getByLabel("Show as CGST + SGST").isChecked(), true);
  // Same state as the business (Telangana, from the GSTIN), so CGST + SGST is picked for them.
  assert.match(await form.getByTestId("invoice-tax-type").innerText(), /CGST \+ SGST · place of supply Telangana \(same state as you\)/);
  await form.getByLabel("SAC code").fill("998391");
  await form.getByLabel("Note on the invoice (optional)").fill("Thank you, Dana!");
  await shot(f, "28-create-invoice", false);
  await form.getByRole("button", { name: "Create invoice" }).click();
  await f.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  const invoiceUrl = f.url();
  const doc = f.getByTestId("invoice-document");
  // Numbered per Indian financial year (1 April to 31 March), e.g. RS-2026-27-001.
  const [iy, im] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  const fyStart = im >= 4 ? iy : iy - 1;
  const year = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
  await doc.getByRole("heading", { name: `RS-${year}-001` }).waitFor();
  const text = await doc.innerText();
  assert.match(text, /Tax invoice/i);
  assert.match(text, /Taxable value\s+₹175\.00/);
  assert.match(text, /CGST 9%\s+₹15\.75/);
  assert.match(text, /SGST 9%\s+₹15\.75/);
  assert.match(text, /Total\s+₹206\.50/);
  assert.match(text, /Rupees Two Hundred Six and Fifty Paise Only/);
  assert.match(text, /GSTIN: 36ABCDE1234F1Z5/);
  assert.equal(await doc.getByTestId("invoice-place-of-supply").innerText(), "Telangana (36)");
  assert.equal(await doc.getByTestId("invoice-sac").innerText(), "998391");
  assert.match(text, /Thank you, Dana!/);
  await doc.getByRole("img", { name: /UPI QR code to pay RS-/ }).waitFor();
  await f.getByRole("button", { name: "Print", exact: true }).waitFor();
  {
    const pdf = await pdfDownload(f, f.getByRole("button", { name: "Download PDF" }), new RegExp(`^Invoice-RS-${year}-001\\.pdf$`));
    // Searchable, copyable text (not just a picture).
    const words = await pdfText(pdf);
    if (words !== null) {
      for (const t of [`RS-${year}-001`, "36ABCDE1234F1Z5", "₹206.50", "998391", "Telangana (36)"]) assert.ok(words.includes(t), `invoice PDF text has ${t}`);
    }
  }
  await shot(f, "29-invoice");
  // The payment now links to its invoice instead of offering a second one.
  await f.goto(menuUrl);
  await f.getByRole("link", { name: `Invoice RS-${year}-001 →` }).waitFor();
  // The client sees it on their page.
  await c.reload();
  await c.getByTestId("portal-invoices").getByText(`RS-${year}-001`).waitFor();
  await c.getByTestId("portal-invoices").getByRole("button", { name: "View" }).click();
  await c.getByTestId("invoice-document").getByText(/Total\s*₹206\.50/).waitFor();
  await pdfDownload(c, c.getByRole("button", { name: "Download PDF" }).last(), new RegExp(`^Invoice-RS-${year}-001\\.pdf$`));
  await shot(c, "30-portal-invoice-mobile");
  // The invoices list, then void (the number is never reused).
  await f.goto(`${BASE}/invoices`);
  await f.getByTestId("invoice-list").getByText(`RS-${year}-001`).waitFor();
  await f.goto(invoiceUrl);
  await f.getByRole("button", { name: "Void invoice" }).click();
  await confirmDialog(f);
  await f.getByText(/Voided .* Clients no longer see this invoice/).waitFor();
  await f.goto(menuUrl);
  await f.getByRole("button", { name: "Create invoice" }).first().waitFor();
  await c.reload();
  await c.getByText("Payment schedule").first().waitFor();
  assert.equal(await c.getByTestId("portal-invoices").count(), 0);

  // The sent quote has its number (per financial year) and both parties' details.
  await f.goto(`${menuUrl}/quote`);
  assert.equal(await f.getByTestId("quote-number").innerText(), `QT-${year}-002`); // the brand identity quote was first
  const parties = await f.getByTestId("quote-parties").innerText();
  assert.match(parties, /GSTIN: 36ABCDE1234F1Z5/);
  assert.match(parties, /12 MG Road/);
  assert.match(parties, /Prepared for[\s\S]*Dana Whitfield/i);
  {
    const words = await pdfText(await pdfDownload(f, f.getByRole("button", { name: "Download PDF" }), new RegExp(`^Quote-QT-${year}-002-Menu-card-for-Northwind\\.pdf$`)));
    if (words !== null) for (const t of [`QT-${year}-002`, "36ABCDE1234F1Z5", "₹413.00"]) assert.ok(words.includes(t), `quote PDF text has ${t}`);
  }
  await shot(f, "29b-quote-numbered");

  step("progress & timeline: mark deliverables, client sees progress, timeline filters");
  await f.goto(menuUrl);
  await f.getByTestId("project-progress").getByText("0 of 2 delivered").waitFor();
  await f.getByRole("radiogroup", { name: "Concept options progress" }).getByRole("radio", { name: "Delivered" }).click();
  await f.getByText("Concept options: delivered.").waitFor();
  await f.getByRole("radiogroup", { name: "Final design progress" }).getByRole("radio", { name: "In progress" }).click();
  await f.getByText("Final design: in progress.").waitFor();
  await f.getByTestId("project-progress").getByText(/1 of 2 delivered · 75%/).waitFor();
  const timeline = f.getByTestId("project-timeline");
  await timeline.getByText("Concept options marked delivered").waitFor();
  await f.getByRole("tab", { name: "Payments" }).click();
  await timeline.getByText(/Invoice RS-\d{4}-\d{2}-001 issued/).waitFor();
  assert.equal(await timeline.getByText("Concept options marked delivered").count(), 0);
  await f.getByRole("tab", { name: "Client" }).click();
  await timeline.getByText(/approved by Dana Whitfield/i).first().waitFor();
  await shot(f, "31-progress-timeline");
  await c.reload();
  await c.getByTestId("portal-progress").getByText("1 of 2 delivered").waitFor();
  await c.getByText("Delivered", { exact: true }).first().waitFor();
  await c.getByText("In progress", { exact: true }).first().waitFor();

  step("paid features on Free: analytics locked, expenses and the record PDF behind Solo, with one way to upgrade");
  await f.goto(`${BASE}/analytics`);
  const lock = f.getByTestId("feature-lock");
  await lock.getByText("Analytics is a Solo feature").waitFor();
  await lock.getByText("Available on Solo, ₹499/month.").waitFor();
  // Paid plans aren't on sale in this test setup, so the lock offers early access (same answer as /pricing).
  assert.equal(await lock.getByRole("link", { name: "Join early access" }).getAttribute("href"), "/plan");
  assert.equal(await f.getByTestId("kpi-received").count(), 0);
  await f.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Analytics\s*Solo/ }).waitFor();
  await shot(f, "46-analytics-locked", false);
  await f.goto(`${BASE}/expenses`);
  await f.getByTestId("feature-lock").getByText("Expenses are a Solo feature").waitFor();
  assert.equal(await f.getByTestId("expense-form").count(), 0, "no adding on Free");
  await f.goto(`${projectUrl}/record`);
  await f.getByTestId("project-record").waitFor();
  await f.getByTestId("feature-lock").getByText("PDF export is a Solo feature").waitFor();
  assert.equal(await f.getByRole("button", { name: "Download PDF" }).count(), 0);
  // Upgrade (stand-in for a Razorpay purchase, which the paid-plans step covers end to end).
  await fetch(`http://127.0.0.1:54321/auth/v1/__test/plan?email=priya@studio.test&plan=solo`);

  step("analytics: this month's received, expenses and profit, chart and table, expense log");
  await f.goto(`${BASE}/analytics`);
  await f.getByRole("heading", { name: "Analytics" }).waitFor();
  // Priya's default currency is USD; $1,600 was marked received earlier.
  assert.equal(await f.getByTestId("kpi-received").innerText(), "$1,600.00");
  // Expenses have their own page.
  await f.getByRole("link", { name: "Log one" }).click();
  await f.waitForURL("**/expenses");
  await f.getByLabel("Amount (USD)").fill("50");
  await f.getByLabel("What for (optional)").fill("Figma");
  await f.getByLabel("Project (optional)").selectOption({ label: "Brand identity for Northwind Coffee" });
  await f.getByRole("button", { name: "Add expense" }).click();
  await f.getByText("Expense added.").waitFor();
  await f.getByTestId("expense-list").getByText("Figma").waitFor();
  assert.equal(await f.getByTestId("expenses-total").innerText(), "$50.00");
  await f.getByRole("link", { name: "Analytics", exact: true }).click();
  await f.waitForURL("**/analytics");
  assert.equal(await f.getByTestId("kpi-expenses").innerText(), "$50.00");
  await f.getByTestId("spending-by-category").getByText("Software & subscriptions").waitFor();
  assert.equal(await f.getByTestId("kpi-profit").innerText(), "$1,550.00");
  await f.getByText("Show as a table").click();
  assert.match(await f.getByTestId("monthly-table").innerText(), /\$1,600\.00\s+\$0\.00\s+\$50\.00\s+\$1,550\.00/);
  await f.getByLabel("Currency").selectOption("INR");
  await f.getByTestId("owed-outstanding").getByText("₹206.50").waitFor();
  await f.getByLabel("Currency").selectOption("USD");
  // Profit by project: received minus the linked expense.
  assert.match(await f.getByTestId("project-profit").innerText(), /Brand identity for Northwind Coffee[\s\S]*\$1,600\.00\s+−\$50\.00\s+\$1,550\.00/);
  // Quarter and financial year include this month.
  await f.getByLabel("Period").selectOption("quarter");
  assert.equal(await f.getByTestId("kpi-received").innerText(), "$1,600.00");
  await f.getByLabel("Period").selectOption("fy");
  assert.equal(await f.getByTestId("kpi-received").innerText(), "$1,600.00");
  await f.getByLabel("Period").selectOption("custom");
  await f.getByLabel("From").fill("2020-01-01");
  await f.getByLabel("To").fill("2020-12-31");
  assert.equal(await f.getByTestId("kpi-received").innerText(), "$0.00");
  await f.getByLabel("Period").selectOption("month");
  await shot(f, "32-analytics");
  await f.goto(projectUrl);
  assert.equal(await f.getByTestId("project-profit-so-far").innerText(), "$1,550.00");
  await f.goto(`${BASE}/expenses`);
  await f.getByRole("button", { name: "Delete expense Figma" }).click();
  await confirmDialog(f);
  await f.getByText("No expenses logged for").waitFor();
  await f.goto(projectUrl);
  await f.getByText("Contract total").waitFor();
  assert.equal(await f.getByTestId("project-profit-so-far").count(), 0); // no linked expenses left

  step("part payments: record part of a payment with its date and method; invoice, client page and analytics show the balance");
  await f.goto(menuUrl);
  await f.getByRole("button", { name: "Create invoice" }).first().click();
  await f.getByTestId("create-invoice").getByRole("button", { name: "Create invoice" }).click();
  await f.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  const invoice2 = f.url();
  await f.goto(menuUrl);
  await f.getByRole("button", { name: "Record payment" }).first().click();
  const part = f.getByTestId("record-payment");
  await part.getByLabel("Amount (INR)").fill("300");
  await part.getByRole("button", { name: "Save payment" }).click();
  await part.getByText(/more than the ₹206\.50 still due/).waitFor();
  await part.getByLabel("Amount (INR)").fill("100");
  await part.getByLabel("Method").selectOption("upi");
  await part.getByLabel("Reference (optional)").fill("UTR 5521");
  await part.getByRole("button", { name: "Save payment" }).click();
  await f.getByText("Part payment of ₹100.00 recorded.").waitFor();
  await f.getByText(/Part paid · ₹100\.00 of ₹206\.50/).waitFor();
  await f.getByTestId("payment-records").getByText(/UPI · UTR 5521/).waitFor();
  await shot(f, "33-part-payment", false);
  await f.goto(invoice2);
  assert.equal(await f.getByTestId("invoice-balance").innerText(), "₹106.50");
  await f.getByTestId("invoice-document").getByText("Part paid", { exact: true }).waitFor();
  await c.reload();
  await c.getByText(/₹100\.00 received · ₹106\.50 due/).waitFor();
  const upi2 = new URL(await c.getByTestId("upi-pay").getAttribute("href"));
  assert.equal(upi2.searchParams.get("am"), "106.50");
  await f.goto(`${BASE}/analytics`);
  await f.getByLabel("Currency").selectOption("INR");
  assert.equal(await f.getByTestId("kpi-received").innerText(), "₹100.00");
  await f.getByTestId("owed-outstanding").getByText("₹106.50").waitFor();
  await f.getByTestId("avg-project-value").getByText("₹413.00").waitFor();

  step("reminders: dashboard reminders, add a follow-up for today, mark it done; project follow-ups");
  await f.goto(`${BASE}/dashboard`);
  await f.getByRole("heading", { name: /^Reminders/ }).waitFor();
  await f.getByRole("button", { name: "Add a follow-up" }).click();
  const fu = f.getByTestId("add-follow-up");
  await fu.getByRole("button", { name: "Save follow-up" }).click();
  await fu.getByText("Write what to follow up on.").waitFor();
  await fu.getByLabel("Remind me to").fill("Send Dana the final files");
  const todayLocal = await f.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await fu.getByLabel("Remind me on").fill(todayLocal);
  await fu.getByLabel("Project (optional)").selectOption({ label: "Menu card for Northwind" });
  await fu.getByRole("button", { name: "Save follow-up" }).click();
  const rem = f.getByTestId("reminders");
  await rem.getByText("Send Dana the final files").waitFor();
  await rem.getByText("Due today · Menu card for Northwind").waitFor();
  await shot(f, "34-reminders", false);
  await f.getByRole("button", { name: "Mark “Send Dana the final files” done" }).click();
  await rem.getByText("Send Dana the final files").waitFor({ state: "detached" });
  await f.goto(menuUrl);
  await f.getByRole("button", { name: "Add a follow-up" }).click();
  await f.getByTestId("add-follow-up").getByLabel("Remind me to").fill("Check in on the concepts");
  await f.getByTestId("add-follow-up").getByRole("button", { name: "Save follow-up" }).click();
  await f.getByTestId("project-follow-ups").getByText("Check in on the concepts").waitFor();
  await f.goto(`${BASE}/dashboard`);
  await f.getByRole("heading", { name: /^Reminders/ }).waitFor();
  assert.equal(await f.getByText("Check in on the concepts").count(), 0, "future follow-ups wait for their day");

  step("approval record: everything agreed, with fingerprint, evidence, change orders, revisions, payments and the full log");
  await f.goto(projectUrl);
  await f.getByRole("link", { name: "Approval record" }).click();
  await f.waitForURL(/\/record$/);
  const record = f.getByTestId("project-record");
  await record.getByText("Project record").waitFor();
  const rtext = await record.innerText();
  assert.match(rtext, /Fingerprint \(SHA-256 of the exact content approved\): [0-9a-f]{64}/);
  assert.match(rtext, /approved .* by Dana Whitfield · Chrome on Linux/);
  assert.match(rtext, /Version 1 sent [^\n]*\n+Changes requested by Dana Whitfield/);
  assert.match(rtext, /#1 Loyalty card design/);
  assert.match(rtext, /Approved by Dana Whitfield/);
  assert.match(rtext, /outside the agreed scope/);
  assert.match(rtext, /Bank transfer · Wise transfer #4471/);
  assert.match(rtext, /full activity log/i);
  // A long record spans several PDF pages.
  const recordPdf = await pdfDownload(f, f.getByRole("button", { name: "Download PDF" }), /^Project-record-Brand-identity-for-Northwind-Coffee\.pdf$/);
  assert.ok((recordPdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length >= 2, "record PDF has more than one page");
  await shot(f, "35-approval-record");

  // Back on Free: past expenses stay visible, read-only.
  await fetch(`http://127.0.0.1:54321/auth/v1/__test/plan?email=priya@studio.test&plan=free`);

  step("outside requests, due dates, adding clients: log a WhatsApp request, the client sees it; add a client and start a project for them");
  await f.goto(projectUrl);
  await f.getByTestId("deliverable-due").first().getByText("Due Nov 23, 2026 (incl. change-order extensions)").waitFor();
  await f.goto(menuUrl);
  await f.getByRole("button", { name: "Log a request from WhatsApp, call or email" }).click();
  const lr = f.getByTestId("log-request");
  await lr.getByLabel("What did they ask for?").selectOption("new_work");
  await lr.getByLabel("Their request").fill("Could you also design a takeaway cup sleeve?");
  await lr.getByLabel("How it arrived").selectOption("whatsapp");
  await lr.getByRole("button", { name: "Log request" }).click();
  await f.getByText(/outside the agreed scope, so propose a change order/).waitFor();
  await f.getByText(/via WhatsApp on [^·]+· logged/).waitFor();
  await shot(f, "43-logged-request", false);
  await c.goto("about:blank");
  await c.goto(menuPortal);
  await c.getByText("Could you also design a takeaway cup sleeve?").waitFor();
  await c.getByText(/You asked by WhatsApp on [^·]+· recorded by/).waitFor();
  await f.goto(`${BASE}/clients`);
  await f.getByRole("button", { name: "Add client" }).click();
  const nc = f.getByTestId("add-client");
  await nc.getByRole("button", { name: "Add client" }).click();
  await nc.getByText(/name is required|Enter the client's name/i).first().waitFor();
  await nc.getByLabel("Name").fill("Arjun Rao");
  await nc.getByLabel("Email").fill("arjun@rao.test");
  await nc.getByLabel("Company (optional)").fill("Rao Bakers");
  await nc.getByRole("button", { name: "Add client" }).click();
  await f.getByText("Client added.").waitFor();
  await f.getByRole("heading", { name: /Arjun Rao/ }).waitFor();
  await f.getByRole("link", { name: "New project for Arjun" }).click();
  await f.waitForURL(/\/projects\/new\?client=/);
  // This account is at the Free plan's 2 active projects, so the form explains the limit instead.
  await f.getByText("You've reached the Free plan's active projects").waitFor();

  step("clients: archive hides a client and frees a plan slot, restore brings it back, delete removes one added by mistake");
  await f.goto(`${BASE}/clients`);
  await f.getByTestId("clients-list").getByText("Arjun Rao").first().click();
  await f.getByRole("heading", { name: /Arjun Rao/ }).waitFor();
  const mc = f.getByTestId("manage-client");
  await mc.getByRole("button", { name: "Archive client" }).click();
  await confirmDialog(f);
  await f.getByText("Client archived.").waitFor();
  await f.getByText(/^Archived on /).waitFor();
  await shot(f, "44-client-archived", false);
  await f.goto(`${BASE}/clients`);
  await f.getByTestId("clients-list").getByText("Dana Whitfield").first().waitFor();
  assert.equal(await f.getByTestId("clients-list").getByText("Arjun Rao").count(), 0, "archived clients are hidden");
  await f.getByRole("button", { name: "Archived clients (1)" }).click();
  await f.getByTestId("clients-list").getByText("Arjun Rao").first().click();
  await mc.getByRole("button", { name: "Restore client" }).click();
  await f.getByText("Client restored.").waitFor();
  // Clients with projects can only be archived; this one has none, so it can be deleted.
  await mc.getByRole("button", { name: "Delete client" }).click();
  await confirmDialog(f);
  await f.getByText("Client deleted.").waitFor();
  await f.waitForURL(/\/clients$/);
  assert.equal(await f.getByText("Arjun Rao").count(), 0);

  step("change order with GST: the project's 18% is added to the price, and the client sees both");
  await f.goto(`${menuUrl}/change-orders/new`);
  await f.getByLabel("Title").fill("Takeaway cup sleeve");
  await f.getByLabel("Price (INR)").fill("100");
  assert.equal(await f.getByLabel("GST (%)").inputValue(), "18");
  const coTotals = await f.getByTestId("co-totals").innerText();
  assert.match(coTotals, /Price\s+₹100\.00/);
  assert.match(coTotals, /GST 18%\s+₹18\.00/);
  assert.match(coTotals, /Client pays\s+₹118\.00/);
  assert.match(coTotals, /New contract total\s+₹531\.00/);
  await shot(f, "45-change-order-gst", false);
  await f.getByRole("button", { name: "Send for approval" }).click();
  await f.getByText(/Change order sent/).waitFor();
  await f.getByText(/incl\. GST ₹18\.00/).first().waitFor();
  await c.goto("about:blank");
  await c.goto(menuPortal);
  await c.getByTestId("portal-co-totals").getByText(/₹100\.00 \+ GST 18% ₹18\.00/).waitFor();

  step("payments after approval: schedule the part of the contract no payment covers, then invoice it");
  await f.goto(menuUrl);
  const unc = f.getByTestId("uncovered");
  await unc.getByText("₹206.50 of the contract isn't covered by a payment yet.").waitFor();
  await unc.getByRole("button", { name: "Add payment to invoice it" }).click();
  const ap = f.getByTestId("add-payment");
  assert.equal(await ap.getByLabel("Amount (INR)").inputValue(), "206.50");
  await ap.getByLabel("Amount (INR)").fill("300");
  await ap.getByRole("button", { name: "Add payment" }).click();
  await ap.getByText("Only ₹206.50 isn't covered by a payment yet.").waitFor();
  await ap.getByLabel("Amount (INR)").fill("206.50");
  await ap.getByRole("button", { name: "Add payment" }).click();
  await f.getByText("Payment added. You can create its invoice now.").waitFor();
  await f.getByTestId("uncovered").waitFor({ state: "detached" });
  await f.getByText("Balance payment").first().waitFor();
  await f.getByTestId("project-timeline").getByText("Payment added: Balance payment (₹206.50)").waitFor();
  await f.getByRole("button", { name: "Create invoice" }).first().waitFor();

  step("password reset by email: request, open the link, choose a new password, sign in with it");
  const resetCtx = await newCtx();
  const a = await resetCtx.newPage();
  a.on("pageerror", (e) => errors.push(`reset pageerror: ${e.message}`));
  await a.goto(`${BASE}/login`);
  await a.getByRole("link", { name: "Forgot your password?" }).click();
  await a.waitForURL("**/forgot-password");
  await a.getByRole("button", { name: "Send reset link" }).click();
  await a.getByText("Enter a valid email").waitFor();
  // Unknown accounts get exactly the same answer (no account probing).
  await a.getByLabel("Email").fill("nobody@studio.test");
  await a.getByRole("button", { name: "Send reset link" }).click();
  await a.getByTestId("reset-sent").getByText(/If an account exists for nobody@studio\.test/).waitFor();
  await a.goto(`${BASE}/forgot-password`);
  await a.getByLabel("Email").fill("priya@studio.test");
  await a.getByRole("button", { name: "Send reset link" }).click();
  await a.getByTestId("reset-sent").waitFor();
  await shot(a, "25-reset-sent", false);
  const AUTH = "http://127.0.0.1:54321/auth/v1";
  assert.equal((await fetch(`${AUTH}/__test/recovery?email=nobody@studio.test`)).status, 404);
  const { link } = await (await fetch(`${AUTH}/__test/recovery?email=priya@studio.test`)).json();
  assert.ok(link.startsWith(`${BASE}/reset-password#access_token=`), link);
  await a.goto(link);
  await a.getByLabel("New password", { exact: true }).waitFor();
  assert.equal(new URL(a.url()).hash, "", "one-time link data is removed from the address bar");
  await a.getByLabel("New password", { exact: true }).fill("new-horse-42");
  await a.getByLabel("Repeat new password").fill("new-horse-43");
  await a.getByRole("button", { name: "Save new password" }).click();
  await a.getByText("The passwords don't match").waitFor();
  await a.getByLabel("Repeat new password").fill("new-horse-42");
  await shot(a, "26-reset-new-password", false);
  await a.getByRole("button", { name: "Save new password" }).click();
  await a.waitForURL("**/dashboard");
  await a.getByText("Hello, Priya").waitFor();
  // An expired or used link is handled clearly, and its data is removed too.
  await a.goto(`${BASE}/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  await a.getByText("This reset link has expired or was already used.").waitFor();
  assert.equal(new URL(a.url()).hash, "");
  await a.goto(`${BASE}/reset-password`);
  await a.getByText("Open the reset link from your email to choose a new password.").waitFor();
  await resetCtx.close();
  const PASSWORD = "new-horse-42";

  step("Sign in with Google: new account → onboarding with name filled; returning user → dashboard");
  {
    const g = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    // newCtx() stubs Google's script, so this never contacts Google.
    const gp = await g.newPage();
    gp.on("pageerror", (e) => errors.push(`google pageerror: ${e.message}`));
    const signup = await gp.goto(`${BASE}/signup`);
    assert.equal(signup.headers()["cross-origin-opener-policy"], "same-origin-allow-popups");
    assert.equal(signup.headers()["referrer-policy"], "strict-origin");
    assert.match(signup.headers()["content-security-policy"], /script-src [^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
    await gp.getByText("By continuing with Google you agree to the").waitFor();
    await gp.getByTestId("google-stub").waitFor();
    const init = await gp.evaluate(() => ({ nonce: window.__gsi.nonce, client: window.__gsi.client_id, mode: window.__gsi.ux_mode }));
    assert.match(init.nonce, /^[0-9a-f]{64}$/, "Google gets a hashed nonce");
    assert.equal(init.client, "1234567890-scopeflowtest.apps.googleusercontent.com");
    assert.equal(init.mode, "popup");
    await shot(gp, "27-signup-google-mobile", false);
    await gp.getByTestId("google-stub").click();
    await gp.waitForURL("**/onboarding");
    assert.equal(await gp.getByLabel("Your name").inputValue(), "Meera Iyer");
    await gp.getByLabel("Business or studio name").fill("Iyer Design");
    await gp.getByLabel("Default currency").selectOption("INR");
    await gp.getByRole("button", { name: "Continue" }).click();
    await gp.waitForURL("**/projects/new?welcome=1");
    // Returning: sign out, then Continue with Google on the sign-in page goes straight in.
    await gp.goto(`${BASE}/dashboard`);
    await gp.getByRole("button", { name: "Open menu" }).click(); // on a phone the account menu is in the drawer
    await gp.getByTestId("nav-drawer").locator('summary[aria-label="Account menu"]').click();
    await gp.getByRole("button", { name: "Sign out" }).click();
    await gp.waitForURL(/\/login/);
    await gp.getByTestId("google-stub").click();
    await gp.waitForURL("**/dashboard");
    await gp.getByText("Hello, Meera").waitFor();
    await g.close();
  }

  step("paid plans: a tester buys Solo in Razorpay Checkout (test mode); verified payment activates it; renewal webhook; cancel");
  {
    const { createHmac } = await import("node:crypto");
    const RZP = { keySecret: "e2e-razorpay-key-secret", webhookSecret: "e2e-razorpay-webhook-secret" };
    const b = await newCtx({ viewport: { width: 1360, height: 900 } });
    // Stand-in for Razorpay's checkout.js: records the options and shows a minimal payment window.
    let checkoutScriptLoads = 0;
    await b.route("https://checkout.razorpay.com/v1/checkout.js", (route) => {
      checkoutScriptLoads++;
      return route.fulfill({
        contentType: "text/javascript",
        body: `window.Razorpay=function(o){this.o=o;this.h={}};
window.Razorpay.prototype.on=function(e,cb){this.h[e]=cb};
window.Razorpay.prototype.open=function(){var o=this.o,h=this.h;window.__rzp=o;
var d=document.createElement("div");d.style.cssText="position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#fff;color:#000;padding:24px;border:1px solid #ccc;width:360px";d.setAttribute("role","dialog");d.setAttribute("aria-label","Razorpay test checkout");
var t=document.createElement("p");t.textContent=o.name+": "+o.description;d.appendChild(t);
window.__rzpPay=function(sig,pay){d.remove();o.handler({razorpay_payment_id:pay,razorpay_subscription_id:o.subscription_id,razorpay_signature:sig})};
window.__rzpFail=function(){h["payment.failed"]&&h["payment.failed"]({error:{description:"Card declined (test)."}})};
var c=document.createElement("button");c.textContent="Close checkout";c.onclick=function(){d.remove();o.modal.ondismiss()};d.appendChild(c);
document.body.appendChild(d)}`,
      });
    });
    const bp = await b.newPage();
    const bErrors = [];
    bp.on("pageerror", (e) => bErrors.push(e.message));
    bp.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && bErrors.push(m.text()));
    await bp.goto(`${BASE}/signup`);
    await bp.getByLabel("Your name").fill("Bina Shah");
    await bp.getByLabel("Email").fill("buyer@studio.test");
    await bp.getByLabel("Password").fill("correct-horse-9");
    await bp.getByRole("button", { name: "Create account" }).click();
    await bp.waitForURL("**/onboarding");
    await bp.getByLabel("Business or studio name").fill("Shah Studio");
    await bp.getByRole("button", { name: "Continue" }).click();
    await bp.waitForURL("**/projects/new?welcome=1");

    const page = await bp.goto(`${BASE}/plan`);
    // Checkout's origins are allowed only because paid plans are on in this build.
    const csp = page.headers()["content-security-policy"];
    assert.match(csp, /script-src [^;]*https:\/\/checkout\.razorpay\.com/);
    assert.match(csp, /frame-src [^;]*https:\/\/api\.razorpay\.com/);
    assert.equal(page.headers()["referrer-policy"], "strict-origin");
    await bp.getByRole("heading", { name: "Plan & usage" }).waitFor();
    await bp.getByText("Test mode: use Razorpay's test card or UPI. No real money moves.").waitFor();
    assert.equal(checkoutScriptLoads, 0, "checkout.js loads only when someone starts a payment");
    // Studio stays in early access; Solo can be bought.
    assert.equal(await bp.getByRole("button", { name: "Upgrade to Studio" }).count(), 1); // testers can try both in test mode
    await bp.getByRole("radio", { name: "Monthly" }).click();

    // 1. Closing the window changes nothing.
    await bp.getByRole("button", { name: "Upgrade to Solo" }).click();
    const win = bp.getByRole("dialog", { name: "Razorpay test checkout" });
    await win.waitFor();
    const opts = await bp.evaluate(() => ({ key: window.__rzp.key, sub: window.__rzp.subscription_id, email: window.__rzp.prefill.email, desc: window.__rzp.description }));
    assert.equal(opts.key, "rzp_test_e2estandin01"); // the key id only; the secret never reaches the browser
    assert.match(opts.sub, /^sub_e2e\d+$/);
    assert.equal(opts.email, "buyer@studio.test");
    assert.match(opts.desc, /Solo plan, billed monthly \(test mode\)/);
    await shot(bp, "62-razorpay-checkout", false);
    await bp.getByRole("button", { name: "Close checkout" }).click();
    await bp.getByRole("button", { name: "Upgrade to Solo" }).waitFor();
    assert.match(await bp.getByRole("heading", { name: /plan$/ }).first().innerText(), /Free plan/);

    // 2. A failed payment, then the window is closed: the reason is shown, nothing changes.
    await bp.getByRole("button", { name: "Upgrade to Solo" }).click();
    await win.waitFor();
    await bp.evaluate(() => window.__rzpFail());
    await bp.getByRole("button", { name: "Close checkout" }).click();
    await bp.getByText("Card declined (test).").waitFor();

    // 3. A genuine payment (signed by Razorpay with the key secret) switches Solo on right away.
    await bp.getByRole("button", { name: "Upgrade to Solo" }).click();
    await win.waitFor();
    const sub = await bp.evaluate(() => window.__rzp.subscription_id);
    const sig = createHmac("sha256", RZP.keySecret).update(`pay_e2e1|${sub}`).digest("hex");
    await bp.evaluate(([s]) => window.__rzpPay(s, "pay_e2e1"), [sig]);
    await bp.getByText("Your plan is active. Thank you!").waitFor();
    await bp.getByRole("heading", { name: "Solo plan" }).waitFor();
    await bp.getByText("Renews").waitFor();
    assert.equal(await bp.getByRole("button", { name: /Upgrade to/ }).count(), 0, "no second subscription while one is active");

    // 4. Razorpay's signed webhook for the charge: idempotent, and the payment appears in billing history.
    const now = Math.floor(Date.now() / 1000);
    const charged = JSON.stringify({
      entity: "event",
      event: "subscription.charged",
      payload: {
        subscription: { entity: { id: sub, status: "active", customer_id: "cust_e2e", current_start: now, current_end: now + 30 * 86400 } },
        payment: { entity: { id: "pay_e2e1", invoice_id: "inv_e2e1", amount: 49900, currency: "INR", status: "captured", created_at: now } },
      },
    });
    const hook = (body, sig) => fetch("http://127.0.0.1:54321/functions/v1/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": "evt_e2e_charge" }, body });
    assert.equal((await hook(charged, createHmac("sha256", "not-the-secret").update(charged).digest("hex"))).status, 401, "forged webhook rejected");
    const signed = createHmac("sha256", RZP.webhookSecret).update(charged).digest("hex");
    assert.deepEqual(await (await hook(charged, signed)).json(), { result: "applied" });
    assert.deepEqual(await (await hook(charged, signed)).json(), { result: "duplicate" });
    await bp.reload();
    await bp.getByText("inv_e2e1").waitFor();
    await bp.getByText(/₹499\.00 · paid/).waitFor();
    await shot(bp, "63-plan-paid");

    // 5. Cancel: keeps Solo until the end of the paid period.
    await bp.getByRole("button", { name: "Cancel plan" }).click();
    await confirmDialog(bp);
    await bp.getByText(/You keep your plan until the end of the period you paid for/).waitFor();
    await bp.getByTestId("cancelling").waitFor();
    await bp.getByRole("heading", { name: "Solo plan" }).waitFor();
    assert.equal(await bp.getByRole("button", { name: "Cancel plan" }).count(), 0);

    // The function refuses other websites (CORS) and signed-out callers.
    const pre = await fetch("http://127.0.0.1:54321/functions/v1/billing/checkout", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    assert.equal(pre.status, 403);
    assert.equal((await fetch("http://127.0.0.1:54321/functions/v1/billing/checkout", { method: "POST", body: "{}" })).status, 401);
    assert.deepEqual(bErrors, [], "no browser errors during checkout");
    await b.close();
  }

  step("blog: an author writes and publishes from the app; a publishing key posts for a tool; pages are rendered for search engines");
  {
    // Before any posts: the blog says so, and the home page has no blog section.
    const v = await desk.newPage();
    const vErrors = [];
    v.on("pageerror", (e) => vErrors.push(e.message));
    v.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && vErrors.push(m.text()));
    await v.goto(`${BASE}/blog`);
    await v.getByText("The first posts are on their way.").waitFor();

    const w = await newCtx({ viewport: { width: 1360, height: 900 } });
    const wp = await w.newPage();
    wp.on("pageerror", (e) => vErrors.push(`writer: ${e.message}`));
    await wp.goto(`${BASE}/signup`);
    await wp.getByLabel("Your name").fill("Prakash Writer");
    await wp.getByLabel("Email").fill("writer@studio.test");
    await wp.getByLabel("Password").fill("correct-horse-9");
    await wp.getByRole("button", { name: "Create account" }).click();
    await wp.waitForURL("**/onboarding");
    await wp.getByLabel("Business or studio name").fill("Writer Studio");
    await wp.getByRole("button", { name: "Continue" }).click();
    await wp.waitForURL("**/projects/new?welcome=1");
    // Authors get a Blog item in the sidebar.
    await wp.getByRole("link", { name: "Blog", exact: true }).click();
    await wp.waitForURL("**/blog/write");
    await wp.getByRole("button", { name: "Write a post" }).first().click();
    await wp.getByRole("button", { name: "Publish" }).click();
    await wp.getByText("Give the post a title of 5 to 120 characters.").waitFor();
    await wp.getByLabel("Title").fill("How much should a logo cost in India?");
    await wp.getByLabel("Category").selectOption("market-prices");
    await wp.getByLabel("Summary").fill("Typical logo prices for Indian freelancers, and how to set yours with confidence.");
    await wp.getByLabel("Post", { exact: true }).fill("## Typical ranges\n\nMost freelancers charge **per project**.\n\n| Level | Price |\n|---|---|\n| Starting out | ₹5,000 |\n| Experienced | ₹25,000 |\n\n- Count your hours\n- Add revisions\n\n<script>window.__xss = 1</script>");
    // Photos: a cover, and one inside the post (uploaded, shrunk and served from the blog's storage).
    await wp.getByLabel("Cover photo file").setInputFiles(new URL("../../public/og.png", import.meta.url).pathname);
    await wp.getByText("Cover photo added.").waitFor();
    const cover = await wp.getByTestId("cover-preview").locator("img").getAttribute("src");
    assert.match(cover, /^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/public\/blog\/\d{4}\/\d{2}\/[0-9a-f-]+\.(webp|jpg)$/);
    await wp.getByLabel("Post", { exact: true }).click();
    await wp.getByLabel("Post", { exact: true }).press("Control+End");
    await wp.getByLabel("Photo file for the post").setInputFiles(new URL("../../public/icon-512.png", import.meta.url).pathname);
    await wp.getByText("Photo added to the post.").waitFor();
    assert.match(await wp.getByLabel("Post", { exact: true }).inputValue(), /!\[icon 512\]\(http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/public\/blog\/[^)]+\)/);
    await wp.getByRole("tab", { name: "Preview" }).click();
    await wp.getByTestId("post-preview").locator("img[alt='icon 512']").waitFor();
    await wp.getByTestId("post-preview").getByRole("heading", { name: "Typical ranges" }).waitFor();
    await shot(wp, "64-blog-editor", false);
    await wp.getByRole("button", { name: "Publish" }).click();
    await wp.getByText("Published. It's live on the blog now.").waitFor();
    await wp.getByTestId("my-posts").getByText("How much should a logo cost in India?").waitFor();

    // A publishing key for a tool (shown once), then the tool posts with it.
    await wp.getByLabel("Key name").fill("Grok");
    await wp.getByRole("button", { name: "Create key" }).click();
    const key = (await wp.getByTestId("new-key").locator("code").innerText()).trim();
    assert.match(key, /^sfblog_[A-Za-z0-9_-]{40,}$/);
    await wp.getByRole("button", { name: "Done" }).click();
    assert.equal(await wp.getByText(key).count(), 0, "the key is never shown again");
    const api = (body, auth = `Bearer ${key}`) => fetch("http://127.0.0.1:54321/functions/v1/blog/posts", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
    const toolPost = { title: "Five ways to win repeat clients", description: "Simple habits that turn one-off freelance projects into steady repeat work.", category: "Strategies", body: "## 1. Deliver early\n\nClients remember it." };
    assert.equal((await api(toolPost, "Bearer sfblog_wrongwrongwrongwrongwrong")).status, 401);
    const made = await api(toolPost);
    assert.equal(made.status, 201);
    const madeBody = await made.json();
    assert.equal(madeBody.url, "http://localhost:3000/blog/five-ways-to-win-repeat-clients");

    // Search engines get full pages: title, canonical, structured data, the post itself, and no script from the post.
    const raw = await (await fetch(`${BASE}/blog/how-much-should-a-logo-cost-in-india`, { headers: { accept: "text/html" } })).text();
    assert.ok(raw.includes("<title>How much should a logo cost in India? | ScopeFlow blog</title>"));
    assert.ok(raw.includes('<link rel="canonical" href="https://scopeflow.in/blog/how-much-should-a-logo-cost-in-india" />'));
    assert.ok(raw.includes("<td>₹25,000</td>"));
    assert.ok(!raw.includes("<script>window.__xss"), "post HTML is escaped");
    assert.ok(raw.includes('"@type":"BlogPosting"'));
    assert.ok(raw.includes(`<meta property="og:image" content="${cover}" />`), "link previews use the cover photo");
    assert.ok(raw.includes('alt="icon 512" loading="lazy"'), "photos in the post are in the page");
    const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
    assert.ok(sm.includes("<loc>https://scopeflow.in/blog/five-ways-to-win-repeat-clients</loc>"));
    assert.ok(sm.includes("<loc>https://scopeflow.in/pricing</loc>"));
    assert.ok((await (await fetch(`${BASE}/blog/rss.xml`)).text()).includes("<title>Five ways to win repeat clients</title>"));
    assert.equal((await fetch(`${BASE}/blog/not-a-post`, { headers: { accept: "text/html" } })).status, 404);

    // Readers: the post page (the app takes over the rendered page), the list, and the home page section.
    await v.goto(`${BASE}/blog/how-much-should-a-logo-cost-in-india`);
    await v.getByRole("heading", { level: 1, name: "How much should a logo cost in India?" }).waitFor();
    await v.getByTestId("blog-body").getByRole("cell", { name: "₹25,000" }).waitFor();
    assert.equal(await v.evaluate(() => window.__xss), undefined, "a script in a post never runs");
    // Photos load (allowed by the security policy) and show at full width.
    await v.waitForFunction(() => [...document.querySelectorAll("main img")].length >= 2 && [...document.querySelectorAll("main img")].every((i) => i.complete && i.naturalWidth > 0));
    await v.getByRole("heading", { name: "More from the blog" }).waitFor();
    await shot(v, "65-blog-post");
    await v.getByRole("link", { name: "Blog", exact: true }).first().click();
    await v.getByTestId("blog-featured").getByRole("link", { name: "Five ways to win repeat clients", exact: true }).waitFor();
    await v.getByRole("link", { name: "Market prices" }).first().click();
    await v.waitForURL("**/blog?category=market-prices");
    await v.getByTestId("blog-featured").getByRole("link", { name: "How much should a logo cost in India?", exact: true }).waitFor();
    assert.equal(await v.getByText("Five ways to win repeat clients").count(), 0);
    await shot(v, "66-blog-list", false);
    await v.goto(BASE);
    await v.getByTestId("home-blog").getByText("Five ways to win repeat clients").waitFor();
    assert.deepEqual(vErrors, [], "no browser errors on the blog");
    await v.close();
    await w.close();
  }

  step("clients: profile, history and private notes");
  await f.goto(`${BASE}/clients`);
  await f.getByRole("link", { name: /Dana Whitfield/ }).click();
  await f.getByRole("heading", { name: "Approval history" }).waitFor();
  await f.getByText(/Scope approved by Dana Whitfield/).first().waitFor();
  await f.getByText(/Wise transfer #4471/).waitFor();
  await f.getByRole("button", { name: "Edit" }).click();
  await f.getByLabel("Phone").fill("+1 555 0100");
  await f.getByLabel("Private notes").fill("Prefers email. Approves quickly.");
  await f.getByRole("button", { name: "Save" }).click();
  await f.getByText("Client saved.").waitFor();
  await f.getByText("Prefers email. Approves quickly.").waitFor();
  // Client history: invoices, quotes, payment records, repeat client.
  await f.getByTestId("client-invoices").getByText(/RS-\d{4}-\d{2}-002/).waitFor();
  assert.equal(await f.getByTestId("client-quotes").getByRole("link", { name: "Quote" }).count(), 2);
  await f.getByText("Repeat client").waitFor();
  await f.getByText(/UPI · UTR 5521/).waitFor();
  await shot(f, "21-client");

  step("plans: the Free limit is reached at 2 active projects");
  await f.goto(`${BASE}/projects/new`);
  await f.getByText("You've reached the Free plan's active projects").waitFor();
  await f.getByText("Your existing projects and client links keep working.").waitFor();
  assert.equal(await f.getByRole("button", { name: "Create project" }).count(), 0);
  await shot(f, "17-plan-limit", false);
  await f.getByRole("link", { name: "See plans" }).click();
  await f.waitForURL("**/plan");
  await f.getByRole("heading", { name: "Plan & usage" }).waitFor();
  await f.getByText("2 of 2").first().waitFor();
  // Not a blog author: no Blog item, and the writing page says so.
  assert.equal(await f.getByRole("link", { name: "Blog", exact: true }).count(), 0);
  // Payments are in test mode and this isn't a tester account: nothing can be bought.
  assert.equal(await f.getByRole("button", { name: /Upgrade to/ }).count(), 0);
  assert.equal(await f.getByText("Test mode: use Razorpay's test card").count(), 0);
  await f.getByRole("button", { name: "Join early access" }).first().click();
  await f.getByText("On the early-access list", { exact: true }).waitFor();
  await f.getByText(/ScopeFlow hasn't charged you anything/).waitFor();
  await shot(f, "18-plan-usage");
  // Client links at the limit: covered by tests/db/plans.test.ts (this project's link was revoked above).

  step("sign out / sign in again");
  await f.goto(`${BASE}/dashboard`);
  await f.locator("summary[aria-label=\"Account menu\"]").click();
  await f.getByRole("button", { name: "Sign out" }).click();
  await f.waitForURL(/\/login/);
  await f.getByLabel("Email").fill("priya@studio.test");
  await f.getByLabel("Password").fill("correct-horse-9"); // the old password no longer works
  await f.getByRole("button", { name: "Sign in" }).click();
  await f.getByText("Incorrect email or password.").waitFor();
  await f.getByLabel("Password").fill(PASSWORD);
  await f.getByRole("button", { name: "Sign in" }).click();
  await f.waitForURL("**/dashboard");

  step("every main page on a computer: one layout, sidebar navigation, nothing wider than the window");
  for (const [path, name, ready] of [
    ["/dashboard", "50-overview", /^Hello/],
    ["/projects", "51-projects", "Projects"],
    ["/clients", "52-clients", "Clients"],
    ["/quotations", "53-quotations", "Quotations"],
    ["/invoices", "54-invoices", "Invoices"],
    ["/approvals", "55-approvals", "Approvals"],
    ["/analytics", "56-analytics", "Analytics"],
    ["/expenses", "57-expenses", "Expenses"],
    ["/settings", "58-settings", "Settings"],
    ["/plan", "59-plan", /Plan/],
    ["/notifications", "60-notifications", "Notifications"],
    [projectUrl.replace(BASE, ""), "61-project", "Brand identity for Northwind Coffee"],
  ]) {
    await f.goto(`${BASE}${path}`);
    await f.getByRole("heading", { name: ready }).first().waitFor();
    // The sidebar marks where you are.
    if (!path.startsWith("/projects/")) assert.ok(await f.locator('aside nav a[aria-current="page"]').count() <= 1);
    assert.equal(await f.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${path} is wider than the window`);
    await shot(f, name);
  }

  step("mobile freelancer view");
  const fm = await phone.newPage();
  await fm.goto(`${BASE}/login`);
  await fm.getByLabel("Email").fill("priya@studio.test");
  await fm.getByLabel("Password").fill(PASSWORD);
  await fm.getByRole("button", { name: "Sign in" }).click();
  await fm.waitForURL("**/dashboard");
  await fm.goto(projectUrl);
  await fm.getByText("Contract total").waitFor();
  await shot(fm, "15-project-mobile");
  // Phones: jump links on the long project page, and the navigation drawer (no bottom bar covering content).
  const jump = fm.getByTestId("jump-links");
  await jump.getByRole("link", { name: "Payments" }).click();
  await fm.waitForFunction(() => location.hash === "#payments");
  assert.ok(await fm.evaluate(() => Math.abs(document.getElementById("payments").getBoundingClientRect().top) < 200), "jump link scrolls to Payments");
  assert.equal(await fm.locator("[data-testid=mobile-tabs]").count(), 0, "no bottom tab bar");
  await fm.getByRole("button", { name: "Open menu" }).click();
  const drawer = fm.getByTestId("nav-drawer");
  await drawer.getByRole("link", { name: "Invoices" }).click();
  await fm.waitForURL("**/invoices");
  await drawer.waitFor({ state: "hidden" });
  await fm.getByRole("button", { name: "Open menu" }).click();
  assert.equal(await drawer.getByRole("link", { name: "Invoices" }).getAttribute("aria-current"), "page");
  await fm.waitForTimeout(400); // let the drawer finish sliding in
  await shot(fm, "44-menu-mobile", false);
  await fm.getByRole("button", { name: "Close menu" }).click();
  const overflow = await fm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "mobile project page must not scroll horizontally");
  // Every main screen on a phone: no sideways scrolling.
  for (const [path, name, ready] of [
    ["/dashboard", "36-dashboard-mobile", /^Reminders/],
    ["/analytics", "37-analytics-mobile", "Analytics"],
    ["/invoices", "38-invoices-mobile", "Invoices"],
    ["/clients", "39-clients-mobile", "Clients"],
    ["/settings", "40-settings-mobile", "Settings"],
    ["/projects", "45-projects-mobile", "Projects"],
    ["/quotations", "46-quotations-mobile", "Quotations"],
    ["/approvals", "47-approvals-mobile", "Approvals"],
    ["/expenses", "48-expenses-mobile", "Expenses"],
    ["/notifications", "49-notifications-mobile", "Notifications"],
    [menuUrl.replace(BASE, ""), "41-menu-project-mobile", "Menu card for Northwind"],
    [projectUrl.replace(BASE, "") + "/record", "42-record-mobile", "Brand identity for Northwind Coffee"],
  ]) {
    await fm.goto(`${BASE}${path}`);
    await fm.getByRole("heading", { name: ready }).first().waitFor();
    await shot(fm, name);
    const wide = await fm.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > 391 && getComputedStyle(el).position !== "fixed").map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`).slice(0, 5));
    // On a phone, Chrome widens the page to fit content that's too wide, so also check the page stayed at the phone's width.
    const sideways = await fm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || window.innerWidth > 390);
    assert.equal(sideways, false, `${path} scrolls sideways on a phone: ${wide.join(" | ")}`);
  }

  step("responsive: small phones (360), large phones (430) and tablets (820): nothing wider than the screen");
  for (const width of [360, 430, 820]) {
    await fm.setViewportSize({ width, height: 900 });
    for (const path of ["/dashboard", "/projects", "/invoices", "/analytics", "/expenses", "/approvals", projectUrl.replace(BASE, "")]) {
      await fm.goto(`${BASE}${path}`);
      await fm.getByRole("heading", { level: 1 }).first().waitFor();
      const wide = await fm.evaluate((w) => [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > w + 1 && !el.closest("[class*=overflow-x-auto]")).slice(0, 3).map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`), width);
      assert.equal(await fm.evaluate((w) => document.documentElement.scrollWidth > w || window.innerWidth > w, width), false, `${path} at ${width}px: ${wide.join(" | ")}`);
    }
    await fm.goto(`${BASE}/dashboard`);
    await fm.getByRole("heading", { level: 1 }).first().waitFor();
    await shot(fm, `62-overview-${width}`, false);
  }
  await fm.setViewportSize({ width: 390, height: 844 });

  // Last on purpose: this locks the test IP out of the portal for the rest of the hour.
  step("rate limit: 20 failed link lookups lock out the IP, even for a valid link");
  await f.goto(projectUrl);
  await f.getByRole("button", { name: "Create new link" }).click();
  await f.getByRole("heading", { name: "Client link ready" }).waitFor();
  const lockUrl = await f.getByTestId("share-url").innerText();
  await f.getByRole("button", { name: "Done", exact: true }).click();
  await c.goto("about:blank");
  await c.goto(lockUrl);
  await c.getByText("Brand identity for Northwind Coffee").first().waitFor(); // works before the attack
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let sawLimit = false;
  for (let i = 0; i < 20; i++) {
    const fake = Array.from({ length: 43 }, () => alphabet[Math.floor(Math.random() * 64)]).join("");
    await c.goto("about:blank");
    await c.goto(`${BASE}/p#${fake}`);
    await c.getByText(/This link isn't working|Too many requests/).first().waitFor();
    if (await c.getByText("Too many requests").count()) sawLimit = true;
  }
  await c.goto("about:blank");
  await c.goto(lockUrl);
  await c.getByText("Too many requests").first().waitFor();
  await c.getByText("Please wait a few minutes, then reload the page.").waitFor();
  await shot(c, "16-portal-rate-limited-mobile", false);
  console.log(`  (lockout reached${sawLimit ? " during" : " after"} the 20 bad lookups; earlier revoked-link checks also count)`);
} catch (e) {
  for (const [n, p] of [["freelancer", f], ["client", c]]) {
    try {
      console.log(`--- ${n} @ ${p.url()}\n` + (await p.locator("body").innerText()).slice(0, 1500));
      await shot(p, `fail-${n}`);
    } catch {}
  }
  console.log("Browser errors:", errors);
  await browser.close();
  throw e;
}
await browser.close();
// The client portal intentionally logs nothing for rejected links; anything else is a failure.
const real = errors.filter((e) => !/Failed to load resource: the server responded with a status of (400|401|403)/.test(e));
if (real.length) {
  console.log("Browser errors:\n" + real.join("\n"));
  process.exitCode = 1;
} else console.log("✓ end-to-end workflow passed with no browser errors");
