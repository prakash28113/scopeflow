import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-redirect";
import { userMessage } from "@/lib/errors";
import { portalUrl, tokenFromHash, TOKEN_PATTERN } from "@/lib/portal-link";
import { keepAlive } from "../../worker/index";
import worker from "../../worker/index";

describe("client link parsing", () => {
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd"; // 42 chars
  const good = token + "e"; // 43
  it("accepts only well-formed 43-character base64url tokens from the fragment", () => {
    expect(TOKEN_PATTERN.test(good)).toBe(true);
    expect(tokenFromHash(`#${good}`)).toBe(good);
    expect(tokenFromHash(good)).toBe(good);
    for (const bad of ["", "#", `#${token}`, `#${good}x`, "#../../etc/passwd", `#${good.slice(0, 42)}=`, "#<script>alert(1)</script>"]) {
      expect(tokenFromHash(bad)).toBeNull();
    }
  });
  it("puts the token in the fragment so it is never sent to a server", () => {
    const url = new URL(portalUrl("https://scopeflow.example.workers.dev/", good));
    expect(url.pathname).toBe("/p");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#${good}`);
  });
});

describe("redirects", () => {
  it("only allows same-site paths", () => {
    expect(safeNext("/projects/1")).toBe("/projects/1");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", null, 5]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});

describe("error messages", () => {
  it("passes through deliberate messages and hides internals", () => {
    expect(userMessage({ code: "55000", message: "Scope is locked" })).toBe("Scope is locked");
    expect(userMessage({ code: "28000", message: "This link has expired." })).toBe("This link has expired.");
    const original = console.error;
    console.error = () => {};
    expect(userMessage({ code: "XX000", message: "internal: relation secret" })).not.toContain("secret");
    expect(userMessage({ code: "PGRST202", message: "Could not find the function public.x" })).not.toContain("public.x");
    console.error = original;
  });
});

describe("worker", () => {
  const assets = { fetch: async (r: Request) => (new URL(r.url).pathname === "/" ? new Response("<!doctype html>app", { headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 })) };
  const env = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: "anon", ASSETS: assets };
  const req = (path: string, accept: string, method = "GET") => new Request(`https://app.example.workers.dev${path}`, { method, headers: { accept } });

  it("returns a JSON 404 for stray API requests", async () => {
    for (const r of [req("/api/x", "application/json"), req("/p", "text/html", "POST"), req("/missing.js", "text/html"), req("/assets/x", "text/html")]) {
      const res = await worker.fetch(r, env);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("serves the app shell with full security headers when a page is requested outside a navigation", async () => {
    const res = await worker.fetch(req("/projects/1", "text/html,*/*"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'self' https://abcdefghijklmnopqrst.supabase.co");
    expect(res.headers.get("content-security-policy")).not.toContain("challenges.cloudflare.com");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-robots-tag")).toBeNull();
    const portal = await worker.fetch(req("/p", "text/html"), { ...env, TURNSTILE_ENABLED: "true" });
    expect(portal.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(portal.headers.get("cache-control")).toBe("no-store");
    expect(portal.headers.get("content-security-policy")).toContain("challenges.cloudflare.com");
    // Misconfigured (no Supabase URL) → no page rather than a page without a pinned policy.
    expect((await worker.fetch(req("/p", "text/html"), { ...env, SUPABASE_URL: "" })).status).toBe(404);
  });
  it("keep-alive calls only the public health function with the anon key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('"ok"', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await keepAlive({ SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_ANON_KEY: "anon" }, fake)).toBe(true);
    expect(calls[0].url).toBe("https://abc.supabase.co/rest/v1/rpc/health");
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe("anon");
    expect(await keepAlive({ SUPABASE_URL: "ftp://bad", SUPABASE_ANON_KEY: "x" }, fake)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
