import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM script
import { run, publicSupabaseConfig } from "../../scripts/ci/release.mjs";

const REF = "abcdefghijklmnopqrst";
const SUPA = `https://${REF}.supabase.co`;
const APP = "https://scopeflow.prakash-studio.workers.dev";

type Call = { method: string; url: string; body?: unknown; headers?: Record<string, string> };

function world(opts: { subdomain?: string | null; leak?: boolean; badCsp?: boolean; status?: string[]; accounts?: number } = {}) {
  const calls: Call[] = [];
  const statuses = [...(opts.status ?? ["ACTIVE_HEALTHY"])];
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
  const fetch = async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body, headers: init.headers });
    const u = new URL(url);
    // Supabase Management API
    if (u.host === "api.supabase.com") {
      if (u.pathname === "/v1/projects") return json(200, [{ id: REF, name: "scopeflow-beta", status: statuses.length > 1 ? statuses.shift() : statuses[0] }]);
      if (u.pathname.endsWith("/database/query")) {
        const q = String(body.query);
        if (q.startsWith("select name from scopeflow_admin")) return json(201, [{ name: "20261031000000_scopeflow_schema.sql" }]);
        if (q.startsWith("select\n (select count(*)::int from pg_tables"))
          return json(201, [{ tables: 14, without_rls: 0, public_functions: 5, signup_trigger: 1 }]);
        return json(201, []);
      }
      if (u.pathname.endsWith("/config/auth")) return json(200, {});
      if (u.pathname.endsWith("/api-keys")) return json(200, [{ type: "publishable", api_key: "sb_publishable_live123" }]);
    }
    // Cloudflare API
    if (u.host === "api.cloudflare.com") {
      if (u.pathname === "/client/v4/accounts")
        return json(200, { success: true, result: Array.from({ length: opts.accounts ?? 1 }, (_, i) => ({ id: `acc${i}` })) });
      if (u.pathname.endsWith("/workers/subdomain")) {
        if (method === "PUT") return json(200, { success: true, result: { subdomain: body.subdomain } });
        return opts.subdomain === null
          ? json(404, { success: false, errors: [{ code: 10007 }] })
          : json(200, { success: true, result: { subdomain: opts.subdomain ?? "prakash-studio" } });
      }
    }
    // Live site
    if (url.startsWith(APP) || url.startsWith("https://scopeflow.scopeflow-")) {
      const headers: Record<string, string> = {
        "content-security-policy": opts.badCsp ? "default-src *" : `default-src 'self'; connect-src 'self' ${SUPA}`,
        "x-frame-options": "DENY",
      };
      if (u.pathname === "/p") headers["x-robots-tag"] = "noindex, nofollow";
      return new Response("<!doctype html>", { status: 200, headers });
    }
    // Supabase public API
    if (url.startsWith(`${SUPA}/rest/v1/rpc/health`)) return json(200, "ok");
    if (url.startsWith(`${SUPA}/rest/v1/rpc/portal_view`)) return json(200, { error: "invalid_link", message: "x" });
    if (url.startsWith(`${SUPA}/rest/v1/projects`)) return opts.leak ? json(200, [{ id: "p1" }]) : json(401, { code: "42501" });
    return json(404, { message: `unmocked ${method} ${url}` });
  };
  const execs: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
  const exec = (cmd: string, args: string[], o: { env: Record<string, string> }) => {
    execs.push({ cmd, args, env: o.env });
    if (args[0] === "wrangler") return `Uploaded scopeflow\nDeployed scopeflow triggers\n  ${APP}\n`;
    return "";
  };
  let summary = "";
  const deps = (env: Record<string, string>) => ({
    env,
    fetch,
    exec,
    log: () => {},
    summary: (s: string) => (summary += s),
    migrations: [{ name: "20261031000000_scopeflow_schema.sql", body: "select 1;" }],
    allowlistFile: "owner@example.com",
    wait: async () => {},
  });
  return { calls, execs, deps, summary: () => summary };
}

const BOTH = { SUPABASE_ACCESS_TOKEN: "sbp_secret_value", CLOUDFLARE_API_TOKEN: "cf_secret_value" };

describe("release automation — deploy and live checks", () => {
  it("waits cleanly, doing nothing, when no tokens are configured", async () => {
    const w = world();
    expect(await run(w.deps({}))).toBe("waiting-supabase");
    expect(w.calls).toHaveLength(0);
    expect(w.summary()).toMatch(/Waiting for setup/);
  });

  it("deploys end to end with both tokens", async () => {
    const w = world();
    expect(await run(w.deps(BOTH))).toBe("deployed");

    const build = w.execs.find((e) => e.args.join(" ") === "run build")!;
    expect(build.env.VITE_SUPABASE_URL).toBe(SUPA);
    expect(build.env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_live123");
    expect(w.execs.map((e) => e.args[0])).toEqual(["run", "scripts/predeploy-check.mjs", "wrangler"]);
    const deploy = w.execs.find((e) => e.args[0] === "wrangler")!;
    expect(deploy.args).toEqual(["wrangler", "deploy", "--var", `SUPABASE_URL:${SUPA}`, "--var", "SUPABASE_ANON_KEY:sb_publishable_live123", "--var", "TURNSTILE_ENABLED:false"]);
    expect(deploy.env.CLOUDFLARE_ACCOUNT_ID).toBe("acc0");
    // The Supabase token is never handed to the build or to Cloudflare tooling.
    for (const e of w.execs) expect(JSON.stringify(e.env)).not.toContain("sbp_secret_value");

    const siteUrl = w.calls.find((c) => c.url.endsWith("/config/auth") && (c.body as { site_url?: string })?.site_url);
    expect((siteUrl!.body as { site_url: string }).site_url).toBe(APP);
    expect(w.summary()).toContain(`**Live:** ${APP}`);
    expect(w.summary()).not.toMatch(/sbp_secret_value|cf_secret_value/);
  });

  it("registers a free workers.dev subdomain on a brand-new Cloudflare account", async () => {
    const w = world({ subdomain: null });
    expect(await run(w.deps(BOTH))).toBe("deployed");
    const put = w.calls.find((c) => c.method === "PUT" && c.url.endsWith("/workers/subdomain"));
    expect((put!.body as { subdomain: string }).subdomain).toMatch(/^scopeflow-[0-9a-f]{6}$/);
  });

  it("waits for a project that is still being created", async () => {
    const w = world({ status: ["COMING_UP", "COMING_UP", "ACTIVE_HEALTHY"] });
    expect(await run(w.deps(BOTH))).toBe("deployed");
  });

  it("asks for the account id when the token can see several Cloudflare accounts", async () => {
    const w = world({ accounts: 2 });
    await expect(run(w.deps(BOTH))).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it("fails the release if the live site lacks the security policy", async () => {
    await expect(run(world({ badCsp: true }).deps(BOTH))).rejects.toThrow(/Content-Security-Policy/);
  });

  it("fails loudly if anonymous visitors could read project data", async () => {
    await expect(run(world({ leak: true }).deps(BOTH))).rejects.toThrow(/SECURITY/);
  });

  it("publishes the app alone from public settings once the database is set up", async () => {
    const w = world();
    const env = { CLOUDFLARE_API_TOKEN: "cf_secret_value", SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live123" };
    expect(await run(w.deps(env))).toBe("deployed");
    expect(w.calls.some((c) => c.url.includes("api.supabase.com"))).toBe(false);
    const deploy = w.execs.find((e) => e.args[0] === "wrangler")!;
    expect(deploy.args).toContain(`SUPABASE_URL:${SUPA}`);
    expect(w.summary()).toContain(`**Live:** ${APP}`);
  });

  it("refuses secret or malformed keys in the public settings", () => {
    expect(() => publicSupabaseConfig({ SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: ["sb", "secret", "abcdefghijkl"].join("_") })).toThrow(/SECRET/);
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;
    expect(() => publicSupabaseConfig({ SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: jwt("service_role") })).toThrow(/service_role/);
    expect(publicSupabaseConfig({ SUPABASE_URL: SUPA + "/", SUPABASE_PUBLISHABLE_KEY: jwt("anon") }).supabaseUrl).toBe(SUPA);
    expect(() => publicSupabaseConfig({ SUPABASE_URL: "https://evil.example.com", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live123" })).toThrow(/SUPABASE_URL/);
  });
});
