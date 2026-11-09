// End-to-end checks for the QA fix list (QA-SF-FULL1: T1-xx, T2-xx, RT4-xx). Runs after
// workflow.mjs against the same local stack, with its own accounts.
// Usage: BASE=http://localhost:3000 node tests/e2e/fixes.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

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
  // Razorpay's checkout.js is fetched ahead of a click (T2-03); tests never reach the real one.
  await c.route("https://checkout.razorpay.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: "window.Razorpay=function(){};window.Razorpay.prototype.on=function(){};window.Razorpay.prototype.open=function(){};" }));
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
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** Serious and critical accessibility problems on the page (or inside one element), as short lines. */
async function axe(p, selector = null) {
  await p.evaluate(AXE);
  return p.evaluate(async (sel) => {
    const r = await window.axe.run(sel ? document.querySelector(sel) : document, { resultTypes: ["violations"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} ×${v.nodes.length}: ${v.nodes[0].target.join(" ")}`);
  }, selector);
}
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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

  // ------------------------------------------------------------------ T1-02
  step("T1-02 signed out: the Solo button carries the plan through sign-up and set-up to Plan & usage");
  {
    await settings("confirm=0&captcha=0");
    await fetch(`${AUTH}/__test/purchasable?plan=solo&on=1`); // Solo on sale, as on the live site
    const ctx = await newCtx();
    const p = await newPage(ctx, "t1-02 new");
    // The prerendered page carries the build-time plan list for 10 minutes; a later clock makes it re-read.
    await p.clock.install({ time: Date.now() + 11 * 60_000 });
    await p.goto(`${BASE}/pricing`);
    const cta = p.getByTestId("solo-cta");
    await cta.waitFor();
    assert.equal(await cta.getAttribute("href"), "/signup?plan=solo&interval=monthly");
    await p.getByRole("radio", { name: /Yearly/ }).click();
    assert.equal(await cta.getAttribute("href"), "/signup?plan=solo&interval=yearly");
    await cta.click();
    await p.waitForURL(/\/signup\?plan=solo&interval=yearly$/);
    await p.getByLabel("Your name").fill("Chitra Nair");
    await p.getByLabel("Email").fill("chitra@fixes.test");
    await p.getByLabel("Password").fill(PASSWORD);
    await p.getByRole("button", { name: "Create account" }).click();
    await p.waitForURL(/\/onboarding\?plan=solo&interval=yearly$/);
    await p.reload(); // the intent survives a reload during set-up
    await p.getByLabel("Default currency").selectOption("INR");
    await p.getByRole("button", { name: "Continue" }).click();
    await p.waitForURL(/\/plan\?plan=solo&interval=yearly$/);
    await p.locator('[data-plan="solo"][data-selected="true"]').waitFor();
    assert.equal(await p.getByRole("radio", { name: /Yearly/ }).getAttribute("aria-checked"), "true", "the yearly toggle is carried over");
    assert.equal(await p.evaluate(() => localStorage.getItem("sf-plan-intent")), null, "cleared after use");
    assert.equal(await p.locator(".razorpay-container, iframe[src*='razorpay']").count(), 0, "no payment opens by itself");
    await shot(p, "t1-02-plan-selected");
    // T1-03: the GST note sits in the Solo card next to its button, and in the Plans intro.
    await p.locator('[data-plan="solo"]').getByTestId("price-tax-note").waitFor();

    step("T1-02 signed in on Free: the Solo button goes to Plan & usage, never to sign-up");
    await p.goto(`${BASE}/pricing`);
    const signedIn = p.getByTestId("solo-cta");
    await p.waitForFunction(() => document.querySelector('[data-testid="solo-cta"]')?.getAttribute("href")?.startsWith("/plan?"));
    assert.equal(await signedIn.getAttribute("href"), "/plan?plan=solo&interval=monthly");
    await p.getByRole("radio", { name: /Yearly/ }).click();
    assert.equal(await signedIn.getAttribute("href"), "/plan?plan=solo&interval=yearly");
    await p.getByRole("radio", { name: /Monthly/ }).click();
    await signedIn.click();
    await p.waitForURL(/\/plan\?plan=solo&interval=monthly$/);
    await p.locator('[data-plan="solo"][data-selected="true"]').waitFor();
    assert.equal(await p.getByRole("radio", { name: /Monthly/ }).getAttribute("aria-checked"), "true");

    step("T1-02 already on Solo: the button says so and opens the plan page");
    await fetch(`${AUTH}/__test/plan?email=chitra@fixes.test&plan=solo`);
    await p.goto(`${BASE}/pricing`);
    await p.getByTestId("solo-cta").getByText("You're on Solo").waitFor();
    assert.equal(await p.getByTestId("solo-cta").getAttribute("href"), "/plan");
    await fetch(`${AUTH}/__test/plan?email=chitra@fixes.test&plan=free`);
    await ctx.close();
  }

  step("T1-02 with Confirm email on, the emailed link still ends on Plan & usage with Solo selected");
  {
    await settings("confirm=1");
    const ctx = await newCtx();
    const p = await newPage(ctx, "t1-02 confirm");
    await p.goto(`${BASE}/signup?plan=solo&interval=monthly`);
    await p.getByLabel("Your name").fill("Divya Menon");
    await p.getByLabel("Email").fill("divya@fixes.test");
    await p.getByLabel("Password").fill(PASSWORD);
    await p.getByRole("button", { name: "Create account" }).click();
    await p.getByTestId("check-inbox").waitFor();
    const mail = await (await fetch(`${AUTH}/__test/confirmation?email=divya@fixes.test`)).json();
    assert.match(mail.link, /\/auth\/callback\?next=%2Fonboarding%3Fplan%3Dsolo%26interval%3Dmonthly#access_token=/);
    await p.goto(mail.link);
    await p.waitForURL(/\/onboarding\?plan=solo&interval=monthly$/);
    await p.getByLabel("Default currency").selectOption("INR");
    await p.getByRole("button", { name: "Continue" }).click();
    await p.waitForURL(/\/plan\?plan=solo&interval=monthly$/);
    await p.locator('[data-plan="solo"][data-selected="true"]').waitFor();
    await ctx.close();
    await settings("confirm=0");
    await fetch(`${AUTH}/__test/purchasable?plan=solo&on=0`);
  }


  // ------------------------------------------------------------------ T1-03
  step("T1-03 the GST note is on the prerendered pricing page, its FAQ and the Terms; no GSTIN anywhere");
  {
    const NOTE = "₹499/month. No GST is charged: ScopeFlow isn't GST-registered.";
    const text = async (path) => (await (await fetch(`${BASE}${path}`)).text()).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
    const pricing = await text("/pricing");
    assert.ok(pricing.includes(`data-testid="price-tax-note">${NOTE}`), "under the Solo price");
    assert.ok(pricing.includes(`Solo: ${NOTE}`), "compare-table footer");
    assert.ok(pricing.includes("Do prices include GST?"), "pricing FAQ");
    assert.ok((await text("/terms")).includes(`Prices and tax:</strong> Solo is ${NOTE}`), "Terms");
    for (const path of ["/", "/pricing", "/terms", "/refunds", "/contact", "/privacy"]) {
      const page = await text(path);
      assert.ok(!page.includes("business-gstin") && !/GSTIN\s+[0-9]{2}[A-Z]{5}/.test(page) && !page.includes("ScopeFlow GSTIN"), `${path} shows no ScopeFlow GSTIN`);
    }
    assert.ok(pricing.includes('"price":"499"') || pricing.includes('"price":499') || !pricing.includes('"@type":"Offer"'), "structured-data prices untouched");
  }

  // ------------------------------------------------------------------ T1-04
  step("T1-04 Razorpay says 'authenticated' (nothing charged yet): the plan stays Free and the page waits; the captured payment switches Solo on");
  {
    const { createHmac } = await import("node:crypto");
    await fetch(`${AUTH}/__test/razorpay-status?status=authenticated`);
    const ctx = await newCtx();
    await ctx.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.Razorpay=function(o){this.o=o};window.Razorpay.prototype.on=function(){};
window.Razorpay.prototype.open=function(){var o=this.o;window.__rzp=o;window.__rzpPay=function(sig,pay){o.handler({razorpay_payment_id:pay,razorpay_subscription_id:o.subscription_id,razorpay_signature:sig})}}`,
      }),
    );
    const p = await newPage(ctx, "t1-04");
    await signUp(p, "Esha Pillai", "payer@fixes.test");
    await p.goto(`${BASE}/plan`);
    await p.getByRole("radio", { name: "Monthly" }).click();
    await p.getByRole("button", { name: "Upgrade to Solo" }).click();
    await p.waitForFunction(() => window.__rzp);
    const opts = await p.evaluate(() => ({ sub: window.__rzp.subscription_id, desc: window.__rzp.description, keys: Object.keys(window.__rzp).sort() }));
    // T1-03: the GST note is in Razorpay's description; no amount or plan is passed from the browser.
    assert.equal(opts.desc, "Solo plan, billed monthly (test mode). ₹499/month. No GST is charged: ScopeFlow isn't GST-registered.");
    assert.ok(!opts.keys.includes("amount") && !opts.keys.includes("plan_id"));
    const verify = p.waitForResponse((r) => r.url().endsWith("/billing/verify"));
    await p.evaluate(([s]) => window.__rzpPay(s, "pay_fix1"), [createHmac("sha256", "e2e-razorpay-key-secret").update(`pay_fix1|${opts.sub}`).digest("hex")]);
    assert.deepEqual(await (await verify).json(), { verified: true, status: "pending", result: "pending" });
    await p.getByTestId("activating").getByText("Payment received, activating… this can take a minute").waitFor();
    await p.waitForTimeout(3500); // a few polls later: still Free
    assert.match(await p.getByRole("heading", { name: /plan$/ }).first().innerText(), /Free plan/);
    assert.equal(await p.getByTestId("activating").count(), 1, "still waiting");
    await shot(p, "t1-04-activating");
    // Razorpay's signed webhook: first only the mandate (pending), then the captured charge.
    const hook = async (evt, id) => {
      const body = JSON.stringify(evt);
      const r = await fetch("http://127.0.0.1:54321/functions/v1/billing/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-razorpay-event-id": id, "x-razorpay-signature": createHmac("sha256", "e2e-razorpay-webhook-secret").update(body).digest("hex") },
        body,
      });
      return (await r.json()).result;
    };
    const t = Math.floor(Date.now() / 1000);
    const entity = (status) => ({ id: opts.sub, status, customer_id: "cust_e2e", current_start: t, current_end: t + 30 * 86400 });
    assert.equal(await hook({ event: "subscription.authenticated", payload: { subscription: { entity: entity("authenticated") } } }, "evt_fix_auth"), "pending");
    await p.waitForTimeout(2000);
    assert.match(await p.getByRole("heading", { name: /plan$/ }).first().innerText(), /Free plan/);
    const charged = { event: "subscription.charged", payload: { subscription: { entity: entity("active") }, payment: { entity: { id: "pay_fix1", invoice_id: "inv_fix1", amount: 49900, currency: "INR", status: "captured", created_at: t } } } };
    assert.equal(await hook(charged, "evt_fix_charge"), "applied");
    assert.equal(await hook(charged, "evt_fix_charge"), "duplicate");
    await p.getByText("Your plan is active. Thank you!").waitFor();
    await p.getByRole("heading", { name: "Solo plan" }).waitFor();
    await fetch(`${AUTH}/__test/razorpay-status?status=active`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ T2-04
  step("T2-04 a wrong password shows the generic error and the Google line, for any address");
  {
    const ctx = await newCtx();
    const p = await ctx.newPage(); // the refused sign-ins are expected 400s
    for (const email of ["asha@fixes.test", "nobody-here@fixes.test"]) {
      await p.goto(`${BASE}/login`);
      assert.equal(await p.getByTestId("google-hint").count(), 0, "not before an error");
      await p.getByLabel("Email").fill(email);
      await p.getByLabel("Password").fill("definitely-wrong-1");
      await p.getByRole("button", { name: "Sign in" }).click();
      await p.getByText("Incorrect email or password.").waitFor();
      assert.equal(await p.getByTestId("google-hint").innerText(), "Signed up with Google? Use 'Continue with Google' above.");
    }
    await shot(p, "t2-04-google-hint");
    await ctx.close();
  }

  // ------------------------------------------------------------------ T2-06 (and RT4-02)
  step("T2-06 mobile pricing: Beta badge clear of the nav at 360/400/414 px, compare table swipeable and focusable, no serious a11y issues");
  {
    for (const width of [360, 400, 414]) {
      const ctx = await newCtx({ ...PHONE, viewport: { width, height: 844 } });
      const p = await newPage(ctx, `t2-06 ${width}`);
      for (const path of ["/pricing", "/privacy", "/terms", "/refunds"]) {
        await p.goto(`${BASE}${path}`);
        const header = p.getByTestId("public-header");
        const badge = await header.getByTestId("beta-badge").boundingBox();
        const pricing = await header.getByRole("link", { name: "Pricing" }).boundingBox();
        const logo = await header.getByRole("link", { name: "ScopeFlow home" }).boundingBox();
        assert.ok(badge && pricing && logo, `${path} @${width}: badge, logo and Pricing are shown`);
        assert.ok(!overlap(badge, pricing), `${path} @${width}: the Beta badge and Pricing don't overlap`);
        assert.ok(pricing.x - (badge.x + badge.width) >= 4, `${path} @${width}: a gap between the badge and Pricing (${Math.round(pricing.x - badge.x - badge.width)}px)`);
        assert.ok(!overlap(badge, logo), `${path} @${width}: the badge doesn't sit on the logo`);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${path} @${width}: no sideways page scroll`);
        if (width !== 414 || path === "/pricing") await shot(p, `t2-06-${path.slice(1)}-${width}`);
      }
      assert.equal(await p.getByTestId("public-header").getByTestId("beta-badge").getAttribute("title"), "Beta: new features ship weekly; prices shown are real.");
      await p.goto(`${BASE}/pricing`);
      const region = p.getByRole("region", { name: "Compare plans" });
      await region.scrollIntoViewIfNeeded();
      assert.equal(await region.getAttribute("tabindex"), "0", "the scroller can be focused from the keyboard");
      assert.ok(await p.getByTestId("compare-swipe-hint").isVisible(), "a visible swipe hint");
      const before = await region.locator("tbody th").first().boundingBox();
      await region.evaluate((el) => (el.scrollLeft = 200));
      const after = await region.locator("tbody th").first().boundingBox();
      assert.ok(Math.abs(before.x - after.x) < 2, "the feature names stay put while the plans scroll");
      assert.deepEqual(await axe(p), [], `/pricing @${width}: axe serious/critical`);
      await ctx.close();
    }
    const ctx = await newCtx();
    const p = await newPage(ctx, "t2-06 desktop");
    await p.goto(`${BASE}/pricing`);
    await p.getByRole("region", { name: "Compare plans" }).waitFor();
    assert.equal(await p.getByTestId("compare-swipe-hint").isVisible(), false, "no swipe hint on desktop");
    assert.deepEqual(await axe(p), [], "/pricing desktop: axe serious/critical");
    // Headings go h1 → h2 → h3 without skipping.
    const levels = await p.evaluate(() => [...document.querySelectorAll("main h1, main h2, main h3")].map((h) => Number(h.tagName[1])));
    assert.ok(levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1), `heading order ${levels.join(",")}`);
    await ctx.close();
  }

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log("✓ fix-list checks passed with no browser errors");
} finally {
  await settings("confirm=0&captcha=0").catch(() => {});
  await fetch(`${AUTH}/__test/purchasable?plan=solo&on=0`).catch(() => {});
  await fetch(`${AUTH}/__test/razorpay-status?status=active`).catch(() => {});
  await browser.close();
}
