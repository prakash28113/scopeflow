import { describe, expect, it } from "vitest";
import { buildCsp, buildHeadersFile, TURNSTILE_ORIGIN } from "../../build/security-headers";

const directives = (csp: string) =>
  Object.fromEntries(csp.split("; ").map((d) => { const [k, ...v] = d.split(" "); return [k, v]; }));

describe("Content-Security-Policy", () => {
  const supabaseUrl = "https://abcd.supabase.co/some/path";

  it("without CAPTCHA: no third-party origins except Supabase for API calls", () => {
    const d = directives(buildCsp({ supabaseUrl, turnstile: false }));
    expect(d["script-src"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'", "https://abcd.supabase.co"]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(buildCsp({ supabaseUrl, turnstile: false })).not.toContain("challenges.cloudflare.com");
  });

  it("with CAPTCHA: Turnstile origin added to script-src, frame-src and connect-src only", () => {
    const csp = buildCsp({ supabaseUrl, turnstile: true });
    const d = directives(csp);
    expect(d["script-src"]).toEqual(["'self'", TURNSTILE_ORIGIN]);
    expect(d["frame-src"]).toEqual([TURNSTILE_ORIGIN]);
    expect(d["connect-src"]).toEqual(["'self'", "https://abcd.supabase.co", TURNSTILE_ORIGIN]);
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
