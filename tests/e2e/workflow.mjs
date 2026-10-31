// End-to-end: drives the real Next.js app in Chrome through the full ScopeFlow workflow.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox"] });
const desk = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const f = await desk.newPage();
const c = await phone.newPage();
const errors = [];
for (const p of [f, c]) {
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
}
const shot = (p, name, full = true) => p.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
const step = (s) => console.log(`• ${s}`);
const flash = (p) => p.locator('[role="status"], [role="alert"]').first().innerText();
try {

// ------------------------------------------------------------ freelancer onboarding
step("landing + sign up");
await f.goto(BASE);
await shot(f, "01-landing", false);
await f.goto(`${BASE}/signup`);
await f.getByLabel("Your name").fill("Priya Raman");
await f.getByLabel("Email").fill("priya@studio.test");
await f.getByLabel("Password").fill("correct-horse-9");
await f.getByRole("button", { name: "Create account" }).click();
await f.waitForURL("**/onboarding");

step("onboarding validation + submit");
await f.getByLabel("Your name").fill("");
await f.getByRole("button", { name: "Continue" }).click();
await f.getByText("Name is required").waitFor();
await f.getByLabel("Your name").fill("Priya Raman");
await f.getByLabel("Business or studio name").fill("Raman Studio");
await f.getByLabel("Default currency").selectOption("USD");
await shot(f, "02-onboarding", false);
await f.getByRole("button", { name: "Continue" }).click();
await f.waitForURL("**/projects/new?welcome=1");

// ------------------------------------------------------------ project creation
step("project form validation");
await f.getByRole("button", { name: "Create project" }).click();
await f.getByText("Please fix the highlighted fields.").waitFor();
assert.ok(await f.getByText("Project title is required").isVisible());

step("create project");
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
await f.getByRole("button", { name: "Add milestone" }).click();
await f.getByLabel("Milestone 2").fill("Final delivery");
await f.locator("#m-amt-1").fill("1600");
await f.locator("#m-due-1").fill("2026-11-27");
await f.getByText("Scheduled $3,200.00 of $3,200.00").waitFor();
await shot(f, "03-new-project");
await f.getByRole("button", { name: "Create project" }).click();
await f.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
const projectUrl = f.url();
await shot(f, "04-project-draft");

// ------------------------------------------------------------ send scope
step("send scope v1");
await f.getByRole("button", { name: "Send to client" }).click();
await f.getByText("Scope v1 sent for approval").waitFor();
await f.getByText(/Email isn't configured, so copy the client link/).waitFor();
const portalUrl = await f.locator("code").first().innerText();
assert.match(portalUrl, /^http:\/\/localhost:3000\/p\/[A-Za-z0-9_-]{43}$/);
await shot(f, "05-project-awaiting");

// ------------------------------------------------------------ client rejects v1
step("client opens portal on phone and requests changes");
await c.goto(portalUrl);
await c.getByText("Please review the scope below").waitFor();
await shot(c, "06-portal-review-mobile");
await c.getByRole("radio", { name: "Request changes" }).click();
await c.getByRole("button", { name: "Send feedback" }).click();
await c.getByText("Tell your freelancer what needs to change").waitFor();
await c.getByLabel("What should change?").fill("Could you add a favicon set? We need it for the web shop.");
await c.getByRole("button", { name: "Send feedback" }).click();
await c.getByText(/Thanks for your feedback on/).waitFor();

step("freelancer revises and resends");
await f.goto(projectUrl);
await f.getByText("asked for changes").waitFor();
await f.getByRole("link", { name: "Edit scope" }).click();
try { await f.getByRole("button", { name: "Add deliverable" }).click({ timeout: 8000 }); }
catch (e) { console.log(f.url()); await shot(f, "debug-edit"); console.log((await f.locator("body").innerText()).slice(0, 1200)); throw e; }
await f.getByLabel("Deliverable 3", { exact: true }).fill("Favicon set");
await f.locator("#d-rev-2").fill("1");
await f.getByRole("button", { name: "Save changes" }).click();
await f.getByText("Scope updated.").waitFor();
await f.getByRole("button", { name: "Send revised scope" }).click();
await f.getByText("Scope v2 sent for approval").waitFor();

// ------------------------------------------------------------ client approves v2
step("client approves v2");
await c.goto(portalUrl);
await c.getByText("This is version 2").waitFor();
assert.ok(await c.getByText("Favicon set").isVisible());
await c.getByRole("button", { name: "Approve scope" }).last().click();
await c.getByText("Please confirm you approve this scope").waitFor();
await c.getByRole("checkbox").check();
await shot(c, "07-portal-approve-mobile");
await c.getByRole("button", { name: "Approve scope" }).last().click();
await c.getByText("Request a change").waitFor();
await c.getByText(/approved by Dana Whitfield/).waitFor();

// ------------------------------------------------------------ revisions
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
assert.match(await request("rev", "Primary logo", "One more round with a rounder cup icon."), /beyond the agreed scope/);
assert.match(await request("new", null, "We'd also like a loyalty card design."), /beyond the agreed scope/);

step("freelancer sees scope check results and proposes a change order");
await f.goto(projectUrl);
await f.getByText("2 requests from your client fall outside the approved scope").waitFor();
assert.equal(await f.getByText("In scope · 1 of 2").count(), 1);
assert.equal(await f.getByText("Over revision limit").count(), 1);
assert.equal(await f.getByText("Outside original scope").count(), 1);
await shot(f, "08-project-requests");
await f.getByRole("link", { name: "Propose change order" }).first().click(); // newest first: loyalty card
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
await f.getByText("Change order sent for approval").waitFor();

// ------------------------------------------------------------ client approves change order
step("client approves the change order");
await c.goto(portalUrl);
await c.getByText("Change order #1: Loyalty card design").waitFor();
await shot(c, "10-portal-change-order-mobile");
await c.getByRole("button", { name: "Approve", exact: true }).click();
await c.getByRole("button", { name: "Confirm approval" }).click();
await c.getByText(/Approved by Dana Whitfield/).waitFor();
await c.getByText("$3,752.50").first().waitFor();

// ------------------------------------------------------------ payments
step("freelancer records payments");
await f.goto(projectUrl);
await f.getByText("Change order #1: Loyalty card design").first().waitFor();
await f.locator("summary", { hasText: "Mark paid" }).first().click();
await f.getByPlaceholder("Reference (optional)").first().fill("Wise transfer #4471");
await f.getByRole("button", { name: "Save" }).first().click();
await f.getByText("Payment recorded.").waitFor();
const totals = await f.locator("dl").first().innerText();
assert.match(totals, /\$3,752\.50/);
assert.match(totals, /\$1,600\.00/);
assert.match(totals, /\$2,152\.50/);
await shot(f, "11-project-active");

step("dashboard");
await f.goto(`${BASE}/dashboard`);
await f.getByText("Hello, Priya").waitFor();
await shot(f, "12-dashboard");

step("client sees payment + history");
await c.goto(portalUrl);
await c.getByText("Received").first().waitFor();
await shot(c, "13-portal-active-mobile");

// ------------------------------------------------------------ security checks through the app
step("security: revoked link, other user, signed-out access");
await f.goto(projectUrl);
f.once("dialog", (d) => d.accept());
await f.getByRole("button", { name: "New link" }).click();
await f.getByText("New client link created").waitFor();
await c.goto(portalUrl);
await c.getByText("This link isn't working").waitFor();

const intruderCtx = await browser.newContext();
const intruder = await intruderCtx.newPage();
await intruder.goto(`${BASE}/signup`);
await intruder.getByLabel("Your name").fill("Mallory");
await intruder.getByLabel("Email").fill("mallory@evil.test");
await intruder.getByLabel("Password").fill("password-123");
await intruder.getByRole("button", { name: "Create account" }).click();
await intruder.waitForURL("**/onboarding");
await intruder.goto(projectUrl);
await intruder.getByText(/Page not found|Set up your workspace/).first().waitFor();
await intruder.getByRole("button", { name: "Continue" }).click().catch(() => {});
await intruder.waitForTimeout(800);
await intruder.goto(projectUrl);
await intruder.getByText("Page not found").waitFor();

const anonCtx = await browser.newContext();
const anon = await anonCtx.newPage();
await anon.goto(projectUrl);
await anon.waitForURL(/\/login\?next=/);

// Mobile freelancer view
const fm = await phone.newPage();
await phone.addCookies(await desk.cookies());
await fm.goto(projectUrl);
await fm.getByText("Contract total").waitFor();
await shot(fm, "14-project-mobile");

} catch (e) {
  for (const [n, p] of [["freelancer", f], ["client", c]]) {
    try { console.log(`--- ${n} @ ${p.url()}\n` + (await p.locator("body").innerText()).slice(0, 1500)); await shot(p, `fail-${n}`); } catch {}
  }
  console.log("Browser errors:", errors);
  await browser.close();
  throw e;
}
await browser.close();
const real = errors.filter((e) => !/favicon/i.test(e));
if (real.length) {
  console.log("Browser errors:\n" + real.join("\n"));
  process.exitCode = 1;
} else console.log("✓ end-to-end workflow passed with no browser errors");
