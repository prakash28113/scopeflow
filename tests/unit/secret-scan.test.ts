import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM script without type declarations
import { scanText } from "../../scripts/secret-scan.mjs";

const jwt = (role: string) =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role, ref: "x" })).toString("base64url"), "c2lnbmF0dXJlLXZhbHVl"].join(".");

describe("secret scanner", () => {
  it("allows the public anon key", () => {
    expect(scanText(`const k = "${jwt("anon")}";`)).toEqual([]);
  });
  it("flags a service-role JWT and other secrets", () => {
    const found = scanText(
      // Fixtures are assembled at runtime so this file itself contains no secret-shaped strings.
      [
        jwt("service_role"),
        ["sb", "secret", "abcdefghijklmnop"].join("_"),
        ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
        "postgres://user" + ":pa55" + "@db.host/x",
        "SUPABASE_SERVICE_ROLE_KEY",
      ].join("\n"),
    );
    expect(found.join("\n")).toMatch(/role "service_role"/);
    expect(found.join("\n")).toMatch(/Supabase secret API key/);
    expect(found.join("\n")).toMatch(/Private key block/);
    expect(found.join("\n")).toMatch(/Database URL with password/);
    expect(found.join("\n")).toMatch(/Server-only env var name/);
  });
});
