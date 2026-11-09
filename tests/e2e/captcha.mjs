// T1-01 with Cloudflare Turnstile configured: the app built with Cloudflare's always-pass test site
// key, the auth stand-in refusing any password call without a token (like Supabase with CAPTCHA on).
// Cloudflare's script is replaced by a stand-in, so nothing leaves this machine.
// Usage: BASE=http://localhost:3000 node tests/e2e/captcha.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:3000";
const AUTH = "http://127.0.0.1:54321/auth/v1";
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox"] });
// Each rendered widget hands over a fresh single-use token after a moment, like the real one.
const TURNSTILE_STUB = `(()=>{let n=0;window.__tsRenders=0;window.turnstile={render(el,o){n++;window.__tsRenders++;const t="TEST.TOKEN."+n;el.dataset.rendered="1";window.__tsKey=o.sitekey;setTimeout(()=>o.callback&&o.callback(t),150);return "w"+n},remove(){},reset(){},execute(){},getResponse(){return ""},isExpired(){return false}};const cb=new URL(document.currentScript.src).searchParams.get("onload");if(cb&&typeof window[cb]==="function")window[cb]();})();`;
const GOOGLE_STUB = `window.google={accounts:{id:{initialize(o){window.__gsi=o},renderButton(el){const b=document.createElement("button");b.type="button";b.textContent="Continue with Google";b.dataset.testid="google-stub";b.onclick=()=>window.__gsi.callback({credential:"test-google:hari@captcha.test:Hari Nair"});el.appendChild(b)}}}};`;
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }));
await ctx.route("https://accounts.google.com/**", (r) => (r.request().url().startsWith("https://accounts.google.com/gsi/client") ? r.fulfill({ contentType: "text/javascript", body: GOOGLE_STUB }) : r.abort()));
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const step = (s) => console.log(`• ${s}`);
const settings = (q) => fetch(`${AUTH}/__test/settings?${q}`).then((r) => r.json());
const takeLog = async () => (await (await fetch(`${AUTH}/__test/captcha-log`)).json()).log;
const PASSWORD = "correct-horse-9";

try {
  await settings("confirm=1&captcha=1");
  await takeLog();

  step("CSP: Turnstile's origin is allowed for scripts and frames");
  const res = await p.goto(`${BASE}/signup`);
  const csp = res.headers()["content-security-policy"];
  assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);

  step("sign-up: the button waits for the check, the request carries the token");
  await p.getByTestId("captcha").waitFor();
  assert.equal(await p.evaluate(() => window.__tsKey), "1x00000000000000000000AA");
  await p.getByLabel("Your name").fill("Hema Das");
  await p.getByLabel("Email").fill("hema@captcha.test");
  await p.getByLabel("Password").fill(PASSWORD);
  const create = p.getByRole("button", { name: "Create account" });
  await p.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
  await create.click();
  await p.getByTestId("check-inbox").waitFor();
  assert.deepEqual(await takeLog(), [{ path: "/signup", token: "TEST.TOKEN.1" }]);

  step("resend: its own fresh token");
  await p.clock.install();
  await p.goto(`${BASE}/signup`);
  await p.getByLabel("Your name").fill("Hema Das");
  await p.getByLabel("Email").fill("hema@captcha.test");
  await p.getByLabel("Password").fill(PASSWORD);
  for (let i = 0; i < 3; i++) await p.clock.runFor(100);
  await p.getByRole("button", { name: "Create account" }).click();
  await p.getByTestId("check-inbox").waitFor();
  for (let i = 0; i < 62; i++) await p.clock.runFor(1000);
  await p.getByTestId("check-inbox").getByRole("button", { name: "Resend", exact: true }).click();
  await p.getByText("Sent again.").waitFor();
  const afterResend = await takeLog();
  assert.equal(afterResend.length, 2);
  assert.equal(afterResend[1].path, "/resend");
  assert.ok(afterResend[1].token && afterResend[1].token !== afterResend[0].token, "resend used a new token, not the sign-up one");
  const { link } = await (await fetch(`${AUTH}/__test/confirmation?email=hema@captcha.test`)).json();

  step("sign-in: a wrong password uses up the token; the retry sends a new one");
  const q = await ctx.newPage(); // (the refused attempt logs an expected 400)
  await q.goto(`${BASE}/login`);
  await q.getByTestId("captcha").waitFor();
  await q.getByLabel("Email").fill("hema@captcha.test");
  await q.getByLabel("Password").fill("wrong-password");
  await q.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
  await q.getByRole("button", { name: "Sign in" }).click();
  await q.getByText("Incorrect email or password.").waitFor();
  const renders = await q.evaluate(() => window.__tsRenders);
  assert.ok(renders >= 2, "the widget was rebuilt after the attempt");
  await q.goto(link); // confirm the account
  await q.waitForURL("**/onboarding");
  await q.getByLabel("Default currency").selectOption("INR");
  await q.getByRole("button", { name: "Continue" }).click();
  await q.waitForURL("**/projects/new?welcome=1");
  await takeLog();

  step("Settings → change password re-checks the current password with a token");
  await q.goto(`${BASE}/settings`);
  await q.getByLabel("Current password").fill(PASSWORD);
  await q.getByLabel("New password", { exact: true }).fill("better-horse-10");
  await q.getByLabel("Confirm new password").fill("better-horse-10");
  await q.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Change password" && !b.disabled));
  await q.getByRole("button", { name: "Change password" }).click();
  await q.getByText("Password changed.").waitFor();
  const pw = await takeLog();
  assert.equal(pw.length, 1);
  assert.ok(pw[0].path.startsWith("/token") && pw[0].token, "the re-check carried a token");

  step("forgot password: token sent");
  const r = await (await browser.newContext()).newPage();
  await r.context().route("https://challenges.cloudflare.com/**", (x) => x.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }));
  await r.context().route("https://accounts.google.com/**", (x) => x.abort());
  await r.goto(`${BASE}/forgot-password`);
  await r.getByLabel("Email").fill("hema@captcha.test");
  await r.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
  await r.getByRole("button", { name: "Send reset link" }).click();
  await r.getByTestId("reset-sent").waitFor();
  const fp = await takeLog();
  assert.equal(fp.length, 1);
  assert.ok(fp[0].path === "/recover" && fp[0].token);
  await r.context().close();

  step("Google sign-in: no CAPTCHA, still works");
  const g = await ctx.newPage();
  await g.evaluate(() => 0);
  await ctx.clearCookies();
  await g.goto(`${BASE}/login`);
  await g.evaluate(() => localStorage.clear());
  await g.goto(`${BASE}/login`);
  await g.getByTestId("google-stub").click();
  await g.waitForURL("**/onboarding");
  assert.deepEqual(await takeLog(), [], "the Google ID-token sign-in made no CAPTCHA-checked call");

  step("a request with no token is refused (what a script would get)");
  const raw = await fetch(`${AUTH}/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "bot@captcha.test", password: PASSWORD }) });
  assert.equal((await raw.json()).error_code, "captcha_failed");

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log("✓ CAPTCHA checks passed");
} finally {
  await settings("confirm=0&captcha=0").catch(() => {});
  await browser.close();
}
