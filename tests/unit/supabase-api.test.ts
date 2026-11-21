import { describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JavaScript module (scripts run by GitHub Actions)
import { TOKEN_HELP, classify, preflight, supabaseQuery } from "../../scripts/lib/supabase-api.mjs";

const REF = "abcdefghijklmnopqrst";
const SECRET = "not-a-real-token-test-value-only";
const reply = (status: number, body: unknown = [{ ok: 1 }]) => new Response(JSON.stringify(body), { status });
const run = (fetch: unknown, extra: Record<string, unknown> = {}) =>
  supabaseQuery({ token: SECRET, ref: REF, query: "select 1", fetch: fetch as typeof globalThis.fetch, sleep: async () => {}, ...extra });

describe("Supabase API errors", () => {
  it("explains a 401 and a 403 differently, with the fix, and never retries them", async () => {
    for (const [status, code, words] of [[401, "token-invalid", /expired, revoked or mistyped/], [403, "token-forbidden", /no access to this project/]] as const) {
      const fetch = vi.fn(async () => reply(status, { message: `Invalid access token ${SECRET}` }));
      const err = await run(fetch).catch((e: { code: string; message: string }) => e);
      expect(err.code).toBe(code);
      expect(err.message).toMatch(words);
      expect(err.message).toContain("SUPABASE_ACCESS_TOKEN");
      expect(err.message).toContain("Environments → production");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("never puts the token or the response body in a message", async () => {
    for (const status of [401, 403, 400, 500]) {
      const err = await run(async () => reply(status, { message: `leak ${SECRET}` })).catch((e: { code: string; message: string }) => e);
      expect(String(err.message)).not.toContain(SECRET);
      expect(String(err.message)).not.toContain("leak");
    }
  });

  it("retries busy or flaky answers, then succeeds or reports 'didn't answer' (not an auth problem)", async () => {
    const flaky = vi.fn().mockResolvedValueOnce(reply(503)).mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(reply(200, [{ n: 3 }]));
    expect(await run(flaky)).toEqual([{ n: 3 }]);
    expect(flaky).toHaveBeenCalledTimes(3);
    const down = vi.fn(async () => reply(502));
    const err = await run(down).catch((e: { code: string; message: string }) => e);
    expect(err.code).toBe("unavailable");
    expect(err.message).not.toMatch(/token/i);
    expect(down).toHaveBeenCalledTimes(3);
  });

  it("a request error that is not busy/auth (400) is reported once, without retrying", async () => {
    const fetch = vi.fn(async () => reply(400));
    expect((await run(fetch).catch((e: { code: string; message: string }) => e)).code).toBe("rejected");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a missing token is named before any request is made", async () => {
    const fetch = vi.fn();
    const err = await supabaseQuery({ token: "", ref: REF, query: "select 1", fetch }).catch((e: { code: string; message: string }) => e);
    expect(err.code).toBe("missing-token");
    expect(err.message).toBe(`SUPABASE_ACCESS_TOKEN is not available to this workflow. ${TOKEN_HELP}`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the token only as a bearer header, with a timeout, and read-only when asked", async () => {
    const fetch = vi.fn(async () => reply(200));
    await preflight({ token: SECRET, ref: REF, fetch });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.supabase.com/v1/projects/${REF}/database/query`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(init.body))).toEqual({ query: "select 1 as ok", read_only: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("classify: success is null; 404 is a plain rejection", () => {
    expect(classify(200)).toBeNull();
    expect(classify(404)?.code).toBe("rejected");
  });
});
