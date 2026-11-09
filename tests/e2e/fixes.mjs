// End-to-end checks for the QA fix list (QA-SF-FULL1: T1-xx, T2-xx, RT4-xx). Runs after
// workflow.mjs against the same local stack, with its own accounts.
// Usage: BASE=http://localhost:3000 node tests/e2e/fixes.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const AUTH = "http://127.0.0.1:54321/auth/v1";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox"] });
const GOOGLE_STUB = `window.google={accounts:{id:{initialize(o){window.__gsi=o;window.__gsiInits=(window.__gsiInits||0)+1},renderButton(el){const b=document.createElement("button");b.type="button";b.textContent="Continue with Google";b.dataset.testid="google-stub";b.onclick=()=>window.__gsi.callback({credential:"test-google:"+(window.__googleAs||"gita@fixes.test:Gita Rao")});el.appendChild(b)}}}};`;
const errors = [];
async function newCtx(opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts });
  await c.route("https://accounts.google.com/**", (route) =>
    route.request().url().startsWith("https://accounts.google.com/gsi/client") ? route.fulfill({ contentType: "text/javascript", body: GOOGLE_STUB }) : route.abort(),
  );
  return c;
}
async function newPage(ctx, who) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${who} pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${who} console: ${m.text()}`));
  return p;
}
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const shot = (p, name, full = false) => p.screenshot({ path: `${OUT}fix-${name}.png`, fullPage: full });
const step = (s) => console.log(`• ${s}`);
const settings = (q) => fetch(`${AUTH}/__test/settings?${q}`).then((r) => r.json());
const PASSWORD = "correct-horse-9";
/** Signs up (Confirm email off) and finishes set-up; ends on the first screen after it. */
async function signUp(p, name, email, { business = "", after = /\/projects\/new\?welcome=1$/ } = {}) {
  await p.goto(`${BASE}/signup`);
  await p.getByLabel("Your name").fill(name);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
  await p.waitForURL(/\/onboarding/);
  if (business) await p.getByLabel("Business or studio name").fill(business);
  await p.getByLabel("Default currency").selectOption("INR");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL(after);
}

try {
  // ------------------------------------------------------------------ T1-01
  step("T1-01 Confirm email off (today): sign-up still goes straight to set-up; no CAPTCHA widget, no token sent");
  {
    await settings("confirm=0&captcha=0");
    await fetch(`${AUTH}/__test/captcha-log`);
    const ctx = await newCtx();
    const p = await newPage(ctx, "t1-01 off");
    await p.goto(`${BASE}/signup`);
    assert.equal(await p.getByTestId("captcha").count(), 0, "no widget without a site key");
    await p.getByLabel("Your name").fill("Asha Rao");
    await p.getByLabel("Email").fill("asha@fixes.test");
    await p.getByLabel("Password").fill(PASSWORD);
    await p.getByRole("button", { name: "Create account" }).click();
    await p.waitForURL("**/onboarding");
    const { log } = await (await fetch(`${AUTH}/__test/captcha-log`)).json();
    assert.deepEqual(log, [{ path: "/signup", token: null }], "no captchaToken in the request without a site key");
    await ctx.close();
  }

  step("T1-01 Confirm email on: Check your inbox, no set-up until the emailed link is opened; resend waits 60 s");
  {
    await settings("confirm=1");
    const ctx = await newCtx();
    const p = await newPage(ctx, "t1-01 on");
    await p.clock.install();
    await p.goto(`${BASE}/signup`);
    await p.getByLabel("Your name").fill("Bela Shah");
    await p.getByLabel("Email").fill("bela@fixes.test");
    await p.getByLabel("Password").fill(PASSWORD);
    await p.getByRole("button", { name: "Create account" }).click();
    const inbox = p.getByTestId("check-inbox");
    await inbox.waitFor();
    assert.match(p.url(), /\/signup$/, "no navigation to set-up");
    const text = (await inbox.innerText()).replace(/\s+/g, " ");
    assert.match(text, /Check your inbox We've sent a link to bela@fixes\.test\. Open it to finish setting up ScopeFlow\./);
    assert.match(text, /Didn't get it\? Resend \(in \d+ s\) · Use a different email/);
    await shot(p, "t1-01-check-inbox");
    const resend = inbox.getByRole("button", { name: /^Resend/ });
    assert.equal(await resend.isDisabled(), true, "resend is off for the first 60 s");
    for (let i = 0; i < 61; i++) await p.clock.runFor(1000); // the countdown re-arms itself each second
    await inbox.getByRole("button", { name: "Resend", exact: true }).click();
    await inbox.getByText("Sent again.").waitFor();
    const mail = await (await fetch(`${AUTH}/__test/confirmation?email=bela@fixes.test`)).json();
    assert.equal(mail.sent, 2, "sign-up sent one email and resend one more");
    assert.match(mail.link, /^http:\/\/localhost:3000\/auth\/callback\?next=%2Fonboarding#access_token=/, "the link comes back to this site's callback page");
    // Before the link is opened, the password alone doesn't get in.
    const probe = await ctx.newPage(); // the refused sign-in is an expected 400
    await probe.goto(`${BASE}/login`);
    await probe.getByLabel("Email").fill("bela@fixes.test");
    await probe.getByLabel("Password").fill(PASSWORD);
    await probe.getByRole("button", { name: "Sign in" }).click();
    await probe.getByText("Confirm your email first").waitFor();
    await probe.close();
    // The emailed link signs in and carries on to set-up; the tokens leave the address bar.
    const res = await p.goto(mail.link);
    assert.match(res.headers()["x-robots-tag"] ?? "", /noindex/);
    assert.equal(res.headers()["cache-control"], "no-store");
    await p.waitForURL("**/onboarding");
    assert.equal(await p.getByLabel("Your name").inputValue(), "Bela Shah");
    assert.equal(await p.evaluate(() => location.hash), "");

    step("T1-01 an address that already has an account gets the identical screen and text");
    const q = await newPage(await newCtx(), "t1-01 existing");
    await q.goto(`${BASE}/signup`);
    await q.getByLabel("Your name").fill("Someone Else");
    await q.getByLabel("Email").fill("bela@fixes.test");
    await q.getByLabel("Password").fill("another-pass-77");
    await q.getByRole("button", { name: "Create account" }).click();
    await q.getByTestId("check-inbox").waitFor();
    const again = (await q.getByTestId("check-inbox").innerText()).replace(/\s+/g, " ").replace(/in \d+ s/, "in N s");
    assert.equal(again, text.replace(/in \d+ s/, "in N s"), "same words for a new and an existing address");
    assert.equal(await q.getByText(/already (exists|registered|has)/i).count(), 0);
    assert.equal((await (await fetch(`${AUTH}/__test/confirmation?email=bela@fixes.test`)).json()).sent, 2, "no email for an existing confirmed account");
    await q.getByRole("button", { name: "Use a different email" }).click();
    await q.getByRole("button", { name: "Create account" }).waitFor();
    await q.context().close();

    step("T1-01 a used or broken link explains itself");
    const bad = await newPage(await newCtx(), "t1-01 bad link");
    await bad.goto(`${BASE}/auth/callback?next=/onboarding#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    await bad.getByTestId("callback-failed").getByText("This link has expired or was already used.").waitFor();
    await bad.goto(`${BASE}/auth/callback?next=https://evil.test`);
    await bad.getByTestId("callback-failed").waitFor();
    await bad.context().close();
    await ctx.close();
    await settings("confirm=0");
  }

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log("✓ fix-list checks passed with no browser errors");
} finally {
  await settings("confirm=0&captcha=0").catch(() => {});
  await browser.close();
}
