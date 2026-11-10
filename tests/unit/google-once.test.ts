import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initGoogleOnce, resetGoogleForTests } from "@/components/google-signin";
import { buildCsp } from "../../build/security-headers";

function fakeGoogle() {
  const calls: Record<string, unknown>[] = [];
  let loads = 0;
  return {
    calls,
    loads: () => loads,
    deps: {
      load: async () => void loads++,
      id: () => ({ initialize: (o: Record<string, unknown>) => void calls.push(o), renderButton: () => {} }) as never,
    },
  };
}

describe("RT4-07 Google Identity is set up once per page load", () => {
  beforeEach(() => resetGoogleForTests());
  it("initialize() runs once however many buttons mount (StrictMode, login then sign-up)", async () => {
    const g = fakeGoogle();
    // StrictMode mounts twice in the same tick; then another page mounts later.
    await Promise.all([initGoogleOnce("client-id", "signin", g.deps), initGoogleOnce("client-id", "signin", g.deps)]);
    await initGoogleOnce("client-id", "signup", g.deps);
    expect(g.calls).toHaveLength(1);
    expect(g.loads()).toBe(1);
    expect(g.calls[0]).toMatchObject({ client_id: "client-id", ux_mode: "popup", auto_select: false, itp_support: true });
    expect(String(g.calls[0].nonce)).toMatch(/^[0-9a-f]{64}$/); // Google only ever sees the hash
  });
  it("a failed load can be retried, and still initialises once", async () => {
    const g = fakeGoogle();
    await expect(initGoogleOnce("c", "signin", { load: async () => { throw new Error("blocked"); }, id: g.deps.id })).rejects.toThrow("blocked");
    await initGoogleOnce("c", "signin", g.deps);
    await initGoogleOnce("c", "signin", g.deps);
    expect(g.calls).toHaveLength(1);
  });
  it("the component goes through that one path", () => {
    const src = readFileSync("src/components/google-signin.tsx", "utf8");
    expect(src.match(/id\.initialize\(\{/g)).toHaveLength(1);
    expect(src).toContain("await initGoogleOnce(GOOGLE_CLIENT_ID, context);");
  });
  it("the policy allows Google's stylesheet and its gsi/ calls, and nothing wider; popups keep working", () => {
    const on = buildCsp({ supabaseUrl: "https://abc.supabase.co", turnstile: false, google: true });
    expect(on).toContain("style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style;");
    expect(on).toMatch(/connect-src 'self' https:\/\/abc\.supabase\.co \S+ https:\/\/accounts\.google\.com\/gsi\/;/);
    expect(on).toContain("script-src 'self' https://static.cloudflareinsights.com https://accounts.google.com/gsi/client;");
    expect(on).not.toMatch(/accounts\.google\.com(?!\/gsi\/)/);
    expect(on).toContain("frame-ancestors 'none'");
    const off = buildCsp({ supabaseUrl: "https://abc.supabase.co", turnstile: false });
    expect(off).not.toContain("google");
    expect(readFileSync("build/security-headers.ts", "utf8")).toContain('"Cross-Origin-Opener-Policy": opts.google || opts.razorpay ? "same-origin-allow-popups" : "same-origin"');
  });
});
