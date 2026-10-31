import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { decryptToken, encryptToken, generateToken, hashToken, isPlausibleToken } from "@/lib/tokens";
import { safeNext } from "@/lib/safe-redirect";
import { escapeHtml, renderEmail } from "@/lib/email";
import { userMessage } from "@/lib/errors";

const secret = Buffer.alloc(32, 7).toString("base64");

describe("share tokens", () => {
  it("are 256-bit and URL-safe", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isPlausibleToken(t)).toBe(true);
    expect(new Set(Array.from({ length: 200 }, generateToken)).size).toBe(200);
  });
  it("hash identically in Node and PostgreSQL", async () => {
    const db = new PGlite();
    const t = generateToken();
    const r = await db.query<{ h: string }>("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [t]);
    expect(hashToken(t)).toBe(r.rows[0].h);
  });
  it("encrypt and decrypt; tampering is detected", () => {
    const t = generateToken();
    const enc = encryptToken(t, secret);
    expect(enc).not.toContain(t);
    expect(decryptToken(enc, secret)).toBe(t);
    const parts = enc.split(".");
    parts[3] = Buffer.from("x".repeat(43)).toString("base64url");
    expect(() => decryptToken(parts.join("."), secret)).toThrow();
    expect(() => decryptToken(enc, Buffer.alloc(32, 8).toString("base64"))).toThrow();
  });
  it("requires a 32-byte key", () => {
    expect(() => encryptToken("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
  it("rejects implausible tokens before hitting the database", () => {
    for (const bad of ["", "short", "a".repeat(200), "../../etc/passwd" + "a".repeat(30), "has space " + "a".repeat(30)]) {
      expect(isPlausibleToken(bad)).toBe(false);
    }
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

describe("emails", () => {
  it("escape user-provided content", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    const { html, text } = renderEmail({
      subject: "s",
      heading: "<b>Project</b>",
      paragraphs: ["<img src=x onerror=alert(1)>"],
      cta: { label: "Open", url: "https://app.example/p/abc?x=1&y=2" },
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Project");
    expect(html).toContain("&amp;y=2");
    expect(text).toContain("https://app.example/p/abc?x=1&y=2");
  });
});

describe("error messages", () => {
  it("passes through deliberate messages and hides internals", () => {
    expect(userMessage({ code: "55000", message: "Scope is locked" })).toBe("Scope is locked");
    const original = console.error;
    console.error = () => {};
    expect(userMessage({ code: "XX000", message: "internal: relation secret" })).not.toContain("secret");
    console.error = original;
  });
});
