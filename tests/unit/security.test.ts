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
  it("returns a JSON 404 for stray API requests", async () => {
    const res = await worker.fetch();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
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
