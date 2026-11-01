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
const desk = await browser.newContext({ viewport: { width: 1360, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
const accept = (p) => p.once("dialog", (d) => d.accept());
const SOON = (() => { const d = new Date(Date.now() + 3 * 86_400_000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); })();

try {
  // ---------------------------------------------------------- freelancer onboarding
  step("landing + sign up (no email confirmation)");
  await f.goto(BASE);
  await f.getByRole("link", { name: "Start free" }).waitFor();
  await f.getByRole("link", { name: "Privacy" }).click();
  await f.getByRole("heading", { name: "Privacy Policy" }).waitFor();
  await f.goto(`${BASE}/terms`);
  await f.getByRole("heading", { name: "Terms of Use" }).waitFor();
  // Public pricing page (signed out): plans come from the database.
  await f.goto(`${BASE}/pricing`);
  await f.getByRole("heading", { name: /Simple pricing/ }).waitFor();
  await f.getByText("Recommended").waitFor();
  await f.getByText("$90.00").waitFor();
  await f.getByRole("radio", { name: "Monthly" }).click();
  await f.getByText("$9.00").waitFor();
  await f.getByText("Not on sale yet — no payment taken.").first().waitFor();
  await shot(f, "00-pricing", false);
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
  await f.getByText("Payment · 50% deposit · Brand identity for Northwind Coffee").waitFor();
  await f.getByText(/^In 3 days/).waitFor();

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
  await f.getByRole("button", { name: "Mark paid" }).first().click();
  await f.getByPlaceholder("Reference (optional)").fill("Wise transfer #4471");
  await f.getByRole("button", { name: "Save" }).click();
  await f.getByText("Paid", { exact: false }).first().waitFor();
  await f.getByText(/Wise transfer #4471/).waitFor();
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
  accept(f);
  await f.getByRole("button", { name: "Replace link" }).click();
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
  accept(f);
  await f.getByRole("button", { name: "Revoke" }).click();
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
  const intruderCtx = await browser.newContext();
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
  const anonCtx = await browser.newContext();
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
  await f.getByText("Price each deliverable").click();
  await f.locator("#d-price-0").fill("150");
  await f.getByRole("radio", { name: "Hourly" }).nth(1).click();
  await f.locator("#d-hours-1").fill("4");
  await f.locator("#d-rate-1").fill("50");
  await f.getByLabel("Tax name").fill("GST");
  await f.getByLabel("Tax %").fill("18");
  const summary = await f.getByTestId("quote-summary").innerText();
  assert.match(summary, /Subtotal\s+\$350\.00/);
  assert.match(summary, /GST\s+\$63\.00/);
  assert.match(summary, /Total\s+\$413\.00/);
  await shot(f, "19-quote-builder");
  await f.getByRole("button", { name: "Create project" }).click();
  await f.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await f.getByTestId("quote-table").waitFor();
  await f.getByRole("link", { name: "Printable quote" }).click();
  await f.waitForURL(/\/quote$/);
  await f.getByText("Prepared for").waitFor();
  assert.match(await f.getByTestId("quote-table").innerText(), /Total\s+\$413\.00/);
  assert.match(await f.getByTestId("quote-table").innerText(), /4 h × \$50\.00/);
  await f.getByRole("button", { name: "Print or save as PDF" }).waitFor();
  await shot(f, "20-printable-quote");

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
  await f.getByLabel("Password").fill("wrong-password");
  await f.getByRole("button", { name: "Sign in" }).click();
  await f.getByText("Incorrect email or password.").waitFor();
  await f.getByLabel("Password").fill("correct-horse-9");
  await f.getByRole("button", { name: "Sign in" }).click();
  await f.waitForURL("**/dashboard");

  step("mobile freelancer view");
  const fm = await phone.newPage();
  await fm.goto(`${BASE}/login`);
  await fm.getByLabel("Email").fill("priya@studio.test");
  await fm.getByLabel("Password").fill("correct-horse-9");
  await fm.getByRole("button", { name: "Sign in" }).click();
  await fm.waitForURL("**/dashboard");
  await fm.goto(projectUrl);
  await fm.getByText("Contract total").waitFor();
  await shot(fm, "15-project-mobile");
  const overflow = await fm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "mobile project page must not scroll horizontally");

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
