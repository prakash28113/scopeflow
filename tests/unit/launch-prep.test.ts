import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UPI_ID, upiPayUrl } from "@/lib/upi";
import { readRecoveryHash } from "@/lib/recovery";
import { newPasswordSchema, resetRequestSchema } from "@/lib/validation";
import { buildHeadersFile, PRIVATE_PATHS } from "../../build/security-headers";
// @ts-expect-error — plain ESM script
import { authReturnUrls } from "../../scripts/ci/release.mjs";

describe("UPI payment links", () => {
  it("builds a standard upi://pay link with the amount in rupees", () => {
    const url = new URL(upiPayUrl({ upiId: "priya.studio@okaxis", payee: "Priya Studio", amountPaise: 2065000, note: "Menu card · Advance" }));
    expect(url.protocol).toBe("upi:");
    expect(Object.fromEntries(url.searchParams)).toEqual({ pa: "priya.studio@okaxis", pn: "Priya Studio", am: "20650.00", cu: "INR", tn: "Menu card  Advance" });
    expect(upiPayUrl({ upiId: "a@b1", payee: "A B", amountPaise: 5, note: "x" })).toContain("am=0.05");
    expect(upiPayUrl({ upiId: "a@b1", payee: "A B", amountPaise: 5, note: "x" })).toContain("pn=A%20B");
  });
  it("keeps notes and names short and free of characters that break UPI apps", () => {
    const url = new URL(upiPayUrl({ upiId: "a@ybl", payee: "N".repeat(80), amountPaise: 100, note: `${"Z".repeat(80)}&pa=evil@ybl` }));
    expect(url.searchParams.get("pa")).toBe("a@ybl");
    expect(url.searchParams.get("pn")).toHaveLength(50);
    expect(url.searchParams.get("tn")!.length).toBeLessThanOrEqual(60);
  });
  it("accepts real UPI IDs and rejects everything else (same rule as the database)", () => {
    for (const ok of ["priya@okaxis", "9876543210@ybl", "priya.studio-1@oksbi", "a_b@paytm"]) expect(UPI_ID.test(ok)).toBe(true);
    for (const bad of ["", "priya", "@ybl", "priya@", "priya@1bank", "pri ya@ybl", "a@b", "x@y@z", "javascript:alert(1)//@ybl"]) expect(UPI_ID.test(bad)).toBe(false);
    const sql = readFileSync("supabase/migrations/20261104000000_upi_payments.sql", "utf8");
    expect(sql).toContain(UPI_ID.source);
  });
});

describe("password reset", () => {
  it("reads Supabase's recovery link and ignores anything else", () => {
    expect(readRecoveryHash("#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery")).toEqual({ kind: "tokens", accessToken: "a.b.c", refreshToken: "r1" });
    expect(readRecoveryHash("#access_token=a&refresh_token=r&type=signup")).toEqual({ kind: "none" });
    expect(readRecoveryHash("")).toEqual({ kind: "none" });
    expect(readRecoveryHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toEqual({ kind: "error", message: "This reset link has expired or was already used." });
    expect(readRecoveryHash("#error=server_error")).toEqual({ kind: "error", message: "This reset link isn't valid." });
  });
  it("validates the request and the new password", () => {
    expect(resetRequestSchema.safeParse({ email: "x" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false);
    const mismatch = newPasswordSchema.safeParse({ password: "long-enough-1", confirm: "long-enough-2" });
    expect(mismatch.error?.issues[0].path).toEqual(["confirm"]);
    expect(newPasswordSchema.safeParse({ password: "long-enough-1", confirm: "long-enough-1" }).success).toBe(true);
  });
  it("reset links may only return to ScopeFlow's own reset page", () => {
    expect(authReturnUrls(["https://scopeflow.in", "https://www.scopeflow.in", "https://scopeflow.in", "http://evil.test", "https://x.test/path", ""])).toBe(
      "https://scopeflow.in/reset-password,https://www.scopeflow.in/reset-password",
    );
  });
  it("reset email is on (Brevo SMTP is set up in Supabase; see docs/EMAIL-SETUP.md)", () => {
    const site = JSON.parse(readFileSync("config/public-site.json", "utf8"));
    expect(site.passwordResetEmail).toBe(true);
  });
  it("reset pages and client links are never indexed or cached", () => {
    const file = buildHeadersFile({ supabaseUrl: "https://x.supabase.co", turnstile: false });
    expect([...PRIVATE_PATHS]).toEqual(["/p", "/reset-password", "/forgot-password"]);
    for (const p of PRIVATE_PATHS) expect(file).toContain(`\n${p}\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n`);
  });
});

describe("link previews and search", () => {
  const html = readFileSync("index.html", "utf8");
  it("has Open Graph and Twitter tags pointing at the live site", () => {
    for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:image" content="https://scopeflow.in/og.png?v=2"', 'property="og:url" content="https://scopeflow.in/"', 'name="twitter:card" content="summary_large_image"'])
      expect(html).toContain(tag);
  });
  it("ships a 1200×630 preview image", () => {
    const png = readFileSync("public/og.png");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(600_000); // WhatsApp skips large preview images
  });
  it("robots.txt keeps account pages out of search but lets previews read client links", () => {
    const robots = readFileSync("public/robots.txt", "utf8");
    expect(robots).toMatch(/Disallow: \/dashboard/);
    expect(robots).not.toMatch(/Disallow: \/p\s*$/m);
    expect(robots).toContain("Sitemap: https://scopeflow.in/sitemap.xml");
    const sitemap = readFileSync("public/sitemap.xml", "utf8");
    expect(sitemap.match(/<loc>/g)).toHaveLength(4);
  });
});
