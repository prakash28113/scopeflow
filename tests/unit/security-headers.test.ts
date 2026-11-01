import { describe, expect, it } from "vitest";
import { ANALYTICS_BEACON_ORIGIN, ANALYTICS_SCRIPT_ORIGIN, buildCsp, buildHeadersFile, TURNSTILE_ORIGIN } from "../../build/security-headers";

const directives = (csp: string) =>
  Object.fromEntries(csp.split("; ").map((d) => { const [k, ...v] = d.split(" "); return [k, v]; }));

describe("Content-Security-Policy", () => {
  const supabaseUrl = "https://abcd.supabase.co/some/path";

  it("without CAPTCHA: no third-party origins except Supabase for API calls", () => {
    const d = directives(buildCsp({ supabaseUrl, turnstile: false }));
    expect(d["script-src"]).toEqual(["'self'", ANALYTICS_SCRIPT_ORIGIN]);
    expect(d["connect-src"]).toEqual(["'self'", "https://abcd.supabase.co", ANALYTICS_BEACON_ORIGIN]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(buildCsp({ supabaseUrl, turnstile: false })).not.toContain("challenges.cloudflare.com");
  });

  it("with CAPTCHA: Turnstile origin added to script-src, frame-src and connect-src only", () => {
    const csp = buildCsp({ supabaseUrl, turnstile: true });
    const d = directives(csp);
    expect(d["script-src"]).toEqual(["'self'", ANALYTICS_SCRIPT_ORIGIN, TURNSTILE_ORIGIN]);
    expect(d["frame-src"]).toEqual([TURNSTILE_ORIGIN]);
    expect(d["connect-src"]).toEqual(["'self'", "https://abcd.supabase.co", ANALYTICS_BEACON_ORIGIN, TURNSTILE_ORIGIN]);
    for (const k of ["default-src", "style-src", "img-src", "font-src", "frame-ancestors", "form-action"]) {
      expect(d[k].join(" ")).not.toContain("cloudflare");
    }
  });

  it("never allows inline/eval scripts, wildcards, plugins or framing", () => {
    for (const turnstile of [false, true]) {
      const csp = buildCsp({ supabaseUrl, turnstile });
      const d = directives(csp);
      expect(d["script-src"]).not.toContain("'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toMatch(/\*|https:(?!\/\/)|http:(?!\/\/)/);
      expect(d["object-src"]).toEqual(["'none'"]);
      expect(d["frame-ancestors"]).toEqual(["'none'"]);
      expect(d["base-uri"]).toEqual(["'none'"]);
    }
  });

  it("emits one Referrer-Policy (no-referrer) and portal no-store/noindex", () => {
    const file = buildHeadersFile({ supabaseUrl, turnstile: false });
    expect(file.match(/Referrer-Policy/g)).toHaveLength(1);
    expect(file).toContain("Referrer-Policy: no-referrer");
    const portal = file.split("\n/p\n")[1].split("\n\n")[0];
    expect(portal).toContain("Cache-Control: no-store");
    expect(portal).toContain("X-Robots-Tag: noindex, nofollow");
  });

  it("rejects a malformed Supabase URL at build time", () => {
    expect(() => buildCsp({ supabaseUrl: "not a url", turnstile: false })).toThrow();
  });
});

import { GOOGLE_GSI, GOOGLE_GSI_SCRIPT, GOOGLE_GSI_STYLE, pageHeaders } from "../../build/security-headers";
// @ts-expect-error — plain ESM script
import { googleSignInEnabled } from "../../scripts/ci/release.mjs";

describe("Sign in with Google", () => {
  const parse = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => { const [k, ...v] = d.split(" "); return [k, v]; }));
  it("off by default: no Google origins, strict referrer and opener policies", () => {
    const h = pageHeaders({ supabaseUrl: "https://abcd.supabase.co", turnstile: false });
    expect(h["Content-Security-Policy"]).not.toContain("accounts.google.com");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
  it("on: only Google's sign-in paths are allowed, the popup can report back, and only the origin is sent", () => {
    const h = pageHeaders({ supabaseUrl: "https://abcd.supabase.co", turnstile: false, google: true });
    const d = parse(h["Content-Security-Policy"]);
    expect(d["script-src"]).toContain(GOOGLE_GSI_SCRIPT);
    expect(d["frame-src"]).toEqual([GOOGLE_GSI]);
    expect(d["connect-src"]).toContain(GOOGLE_GSI);
    expect(d["style-src"]).toContain(GOOGLE_GSI_STYLE);
    expect(h["Content-Security-Policy"]).not.toMatch(/accounts\.google\.com(?!\/gsi)/);
    expect(h["Referrer-Policy"]).toBe("strict-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
  });
  it("with CAPTCHA too: both frames allowed", () => {
    const d = parse(buildCsp({ supabaseUrl: "https://abcd.supabase.co", turnstile: true, google: true }));
    expect(d["frame-src"]).toEqual([TURNSTILE_ORIGIN, GOOGLE_GSI]);
  });
  it("the release only switches it on for a real Google client ID", () => {
    expect(googleSignInEnabled(JSON.stringify({ googleClientId: "" }))).toBe(false);
    expect(googleSignInEnabled(JSON.stringify({ googleClientId: "evil.example.com" }))).toBe(false);
    expect(googleSignInEnabled(JSON.stringify({ googleClientId: "123456789012-abc123def456.apps.googleusercontent.com" }))).toBe(true);
  });
});
