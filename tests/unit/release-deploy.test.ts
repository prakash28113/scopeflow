import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM script
import { run, publicSupabaseConfig, signupsOpen, parseEmails, parseDomains, billingConfig, purchasableSql, blogAuthors, blogAuthorsSql, complimentaryPlans } from "../../scripts/ci/release.mjs";

const REF = "abcdefghijklmnopqrst";
const SUPA = `https://${REF}.supabase.co`;
const APP = "https://scopeflow.prakash-studio.workers.dev";

type Call = { method: string; url: string; body?: unknown; headers?: Record<string, string> };

function world(opts: { subdomain?: string | null; leak?: boolean; badCsp?: boolean; shellHome?: boolean; softNotFound?: boolean; fnForbidden?: boolean; fnVerifyJwt?: boolean; status?: string[]; accounts?: number; authForbidden?: boolean } = {}) {
  const calls: Call[] = [];
  const statuses = [...(opts.status ?? ["ACTIVE_HEALTHY"])];
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
  const fetch = async (url: string, init: { method?: string; body?: string | FormData; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body, headers: init.headers });
    const u = new URL(url);
    // Supabase Management API
    if (u.host === "api.supabase.com") {
      if (u.pathname === "/v1/projects") return json(200, [{ id: REF, name: "scopeflow-beta", status: statuses.length > 1 ? statuses.shift() : statuses[0] }]);
      if (u.pathname.endsWith("/database/query")) {
        const q = String(body.query);
        if (q.startsWith("select name from scopeflow_admin")) return json(201, [{ name: "20261031000000_scopeflow_schema.sql" }]);
        if (q.startsWith("select\n (select count(*)::int from pg_tables"))
          return json(201, [{ tables: 30, without_rls: 0, public_functions: 5, signup_trigger: 1 }]);
        return json(201, []);
      }
      if (u.pathname.endsWith("/config/auth")) return opts.authForbidden ? json(403, { message: "Missing required permission(s): auth_config_write" }) : json(200, {});
      if (u.pathname.endsWith("/secrets")) return opts.fnForbidden ? json(403, { message: "forbidden" }) : json(201, {});
      if (u.pathname.endsWith("/functions/deploy")) return opts.fnForbidden ? json(403, { message: "forbidden" }) : json(201, { slug: u.searchParams.get("slug"), verify_jwt: opts.fnVerifyJwt ?? false });
      if (/\/functions\/(billing|blog)$/.test(u.pathname) && method === "PATCH") return json(200, { verify_jwt: false });
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
    if (url.startsWith(APP) || url.startsWith("https://scopeflow.scopeflow-") || url.startsWith("https://scopeflow.in")) {
      const headers: Record<string, string> = {
        "content-security-policy": opts.badCsp ? "default-src *" : `default-src 'self'; connect-src 'self' ${SUPA}`,
        "x-frame-options": "DENY",
      };
      if (u.pathname === "/p") headers["x-robots-tag"] = "noindex, nofollow";
      if (u.pathname === "/sitemap.xml") return new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 });
      if (u.pathname === "/this-page-does-not-exist") return new Response('<!doctype html><div id="root"></div>', { status: opts.softNotFound ? 200 : 404, headers });
      if (u.pathname === "/" && !opts.shellHome)
        return new Response('<!doctype html><link rel="canonical" href="https://scopeflow.in/" /><div id="root" data-page="/"><h1>x</h1></div>', { status: 200, headers });
      return new Response('<!doctype html><div id="root"></div>', { status: 200, headers });
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
    expect(deploy.args).toEqual(["wrangler", "deploy", "--var", `SUPABASE_URL:${SUPA}`, "--var", "SUPABASE_ANON_KEY:sb_publishable_live123", "--var", "TURNSTILE_ENABLED:false", "--var", "GOOGLE_SIGNIN_ENABLED:false", "--var", "BILLING_ENABLED:false"]);
    expect(deploy.env.CLOUDFLARE_ACCOUNT_ID).toBe("acc0");
    // No Razorpay keys: nothing on sale, no billing function, checkout hidden. The blog API is always deployed.
    expect(build.env.VITE_BILLING_PROVIDER).toBe("");
    expect(w.calls.filter((c) => c.url.includes("/functions/deploy")).map((c) => new URL(c.url).searchParams.get("slug"))).toEqual(["blog"]);
    expect(w.calls.some((c) => String((c.body as { query?: string })?.query ?? "").includes("blog_authors"))).toBe(true);
    expect(w.summary()).toContain(`${SUPA}/functions/v1/blog/posts`);
    expect(w.calls.some((c) => String((c.body as { query?: string })?.query ?? "").includes("purchasable"))).toBe(true);
    // The Supabase token is never handed to the build or to Cloudflare tooling.
    for (const e of w.execs) expect(JSON.stringify(e.env)).not.toContain("sbp_secret_value");

    const siteUrl = w.calls.find((c) => c.url.endsWith("/config/auth") && (c.body as { site_url?: string })?.site_url);
    expect((siteUrl!.body as { site_url: string }).site_url).toBe(APP);
    expect(w.summary()).toContain(`**Live:** ${APP}`);
    expect(w.summary()).not.toMatch(/sbp_secret_value|cf_secret_value/);
  });

  const RZP = { RAZORPAY_KEY_ID: "rzp_test_Abc123xyz", RAZORPAY_KEY_SECRET: "rzp_secret_value_1", RAZORPAY_WEBHOOK_SECRET: "webhook_secret_1", BILLING_TESTERS: "Owner@Example.com" };

  it("with Razorpay keys: sets function secrets, deploys the billing function, and switches checkout on", async () => {
    const w = world({ fnVerifyJwt: true });
    expect(await run(w.deps({ ...BOTH, ...RZP }))).toBe("deployed");
    const secrets = w.calls.find((c) => c.url.endsWith(`/projects/${REF}/secrets`))!;
    expect(secrets.body).toEqual([
      { name: "RAZORPAY_KEY_ID", value: "rzp_test_Abc123xyz" },
      { name: "RAZORPAY_KEY_SECRET", value: "rzp_secret_value_1" },
      { name: "RAZORPAY_WEBHOOK_SECRET", value: "webhook_secret_1" },
      { name: "BILLING_TESTERS", value: "owner@example.com" },
      { name: "APP_ORIGINS", value: "https://scopeflow.prakash-studio.workers.dev" },
    ]);
    const deployFn = w.calls.find((c) => c.url.includes("/functions/deploy?slug=billing"))!;
    expect(w.calls.some((c) => c.url.includes("/functions/deploy?slug=blog"))).toBe(true);
    const form = deployFn.body as FormData;
    expect(JSON.parse(String(form.get("metadata")))).toEqual({ entrypoint_path: "index.ts", name: "billing", verify_jwt: false });
    expect(form.getAll("file").map((f) => (f as File).name)).toEqual(["index.ts", "handler.ts"]);
    // The platform kept JWT verification on → turned off explicitly (the webhook has no session).
    expect(w.calls.find((c) => c.method === "PATCH" && c.url.endsWith("/functions/billing"))!.body).toEqual({ verify_jwt: false });
    const build = w.execs.find((e) => e.args.join(" ") === "run build")!;
    expect(build.env.VITE_BILLING_PROVIDER).toBe("razorpay");
    expect(w.execs.find((e) => e.args[0] === "wrangler")!.args).toContain("BILLING_ENABLED:true");
    // Secrets never reach the build, Cloudflare tooling or the run summary.
    for (const e of w.execs) expect(JSON.stringify(e.args)).not.toMatch(/rzp_secret_value_1|webhook_secret_1/);
    expect(w.summary()).not.toMatch(/rzp_secret_value_1|webhook_secret_1/);
    expect(w.summary()).toMatch(/test mode/);
    expect(w.summary()).toContain(`${SUPA}/functions/v1/billing/webhook`);
  });

  it("keeps paid plans off (and the release going) when the token can't manage functions", async () => {
    const w = world({ fnForbidden: true });
    expect(await run(w.deps({ ...BOTH, ...RZP }))).toBe("deployed");
    expect(w.execs.find((e) => e.args.join(" ") === "run build")!.env.VITE_BILLING_PROVIDER).toBe("");
    expect(w.summary()).toMatch(/Edge Functions/);
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

  it("fails the release if the live home page isn't the prerendered, indexable page", async () => {
    await expect(run(world({ shellHome: true }).deps(BOTH))).rejects.toThrow(/prerendered/);
    await expect(run(world({ softNotFound: true }).deps(BOTH))).rejects.toThrow(/Unknown pages should answer 404/);
  });

  it("fails loudly if anonymous visitors could read project data", async () => {
    await expect(run(world({ leak: true }).deps(BOTH))).rejects.toThrow(/SECURITY/);
  });

  it("publishes the app alone from public settings once the database is set up", async () => {
    const w = world();
    const env = {
      CLOUDFLARE_API_TOKEN: "cf_secret_value",
      SUPABASE_URL: SUPA,
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live123",
      SUPABASE_DATABASE_VERSION: "20261031000000_scopeflow_schema.sql",
    };
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

  it("opens sign-ups only when the allowlist has a lone *", async () => {
    expect(signupsOpen("# comment *\nme@example.com")).toBe(false);
    expect(signupsOpen("# open\n*\n")).toBe(true);
    expect(parseEmails("*\nme@example.com")).toEqual(["me@example.com"]);
    const w = world();
    const deps = { ...w.deps(BOTH), allowlistFile: "*" };
    expect(await run(deps)).toBe("deployed");
    const queries = w.calls.filter((c) => c.url.endsWith("/database/query")).map((c) => String((c.body as { query: string }).query));
    expect(queries).toContain("delete from public.beta_allowlist;");
    expect(queries.some((q) => q.includes("insert into public.beta_allowlist"))).toBe(false);
  });

  it("refuses an app-only release while a database migration is pending", async () => {
    const w = world();
    const deps = {
      ...w.deps({ CLOUDFLARE_API_TOKEN: "cf_secret_value", SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live123", SUPABASE_DATABASE_VERSION: "20261031000000_scopeflow_schema.sql" }),
      migrations: [
        { name: "20261031000000_scopeflow_schema.sql", body: "select 1;" },
        { name: "20261101000000_v1_1_agreement.sql", body: "select 1;" },
      ],
    };
    await expect(run(deps)).rejects.toThrow(/20261101000000_v1_1_agreement\.sql hasn't been applied/);
    expect(w.execs).toHaveLength(0);
  });

  it("just waits (no failure) when a migration is pending and nothing could be deployed anyway", async () => {
    const w = world();
    const deps = {
      ...w.deps({ SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live123", SUPABASE_DATABASE_VERSION: "20261031000000_scopeflow_schema.sql" }),
      migrations: [{ name: "20261101000000_v1_1_agreement.sql", body: "select 1;" }],
    };
    expect(await run(deps)).toBe("waiting-supabase");
    expect(w.summary()).toMatch(/Database update pending/);
  });

  it("with public settings in config, a least-privilege token (database only) is enough", async () => {
    const w = world({ authForbidden: true });
    const env = { ...BOTH, SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live123" };
    expect(await run(w.deps(env))).toBe("deployed");
    const supabaseCalls = w.calls.filter((c) => c.url.includes("api.supabase.com")).map((c) => new URL(c.url).pathname);
    expect(supabaseCalls.some((p) => p === "/v1/projects" || p.endsWith("/api-keys"))).toBe(false);
    expect(supabaseCalls.filter((p) => p.endsWith("/database/query")).length).toBeGreaterThan(2);
    expect(w.summary()).toMatch(/skipped \(token not scoped for Auth config/);
    expect(w.summary()).toContain(`**Live:** ${APP}`);
  });

  it("deploys to the custom domain when configured and uses it as the main address", async () => {
    const w = world();
    expect(await run(w.deps({ ...BOTH, CUSTOM_DOMAINS: "scopeflow.in, www.scopeflow.in" }))).toBe("deployed");
    const deploy = w.execs.find((e) => e.args[0] === "wrangler")!;
    expect(deploy.args.slice(-4)).toEqual(["--domain", "scopeflow.in", "--domain", "www.scopeflow.in"]);
    const siteUrl = w.calls.find((c) => c.url.endsWith("/config/auth") && (c.body as { site_url?: string })?.site_url);
    expect((siteUrl!.body as { site_url: string }).site_url).toBe("https://scopeflow.in");
    expect(w.calls.some((c) => c.url.startsWith("https://scopeflow.in/p"))).toBe(true);
    expect(w.summary()).toContain("**Live:** https://scopeflow.in");
  });

  it("validates custom domains", () => {
    expect(parseDomains("")).toEqual([]);
    expect(parseDomains("ScopeFlow.in,www.scopeflow.in scopeflow.in")).toEqual(["scopeflow.in", "www.scopeflow.in"]);
    expect(() => parseDomains("scopeflow.in/evil")).toThrow(/Not a valid custom domain/);
    expect(() => parseDomains("x.workers.dev")).toThrow(/Not a valid/);
  });
});

describe("billing settings", () => {
  const site = JSON.stringify({ billingPlans: ["solo"] });
  it("is off without keys, and reports (not fails) a partial setup", () => {
    expect(billingConfig({}, site)).toBeNull();
    expect(billingConfig({ RAZORPAY_KEY_ID: "rzp_test_abcdef12" }, site)).toEqual({ error: expect.stringMatching(/RAZORPAY_KEY_SECRET.*RAZORPAY_WEBHOOK_SECRET/) });
    expect(billingConfig({ RAZORPAY_KEY_ID: "pk_live_x", RAZORPAY_KEY_SECRET: "12345678", RAZORPAY_WEBHOOK_SECRET: "12345678" }, site)).toEqual({ error: expect.stringMatching(/RAZORPAY_KEY_ID/) });
  });
  it("derives the mode, testers and plans on sale", () => {
    const live = billingConfig({ RAZORPAY_KEY_ID: "rzp_live_abcdef12", RAZORPAY_KEY_SECRET: "12345678", RAZORPAY_WEBHOOK_SECRET: "12345678", BILLING_TESTERS: "a@x.com" }, JSON.stringify({ billingPlans: ["solo", "studio", "free"] }));
    expect(live).toMatchObject({ mode: "live", testers: ["a@x.com"], plans: ["solo", "studio"] });
    expect(purchasableSql(live)).toContain("id = any(array['solo', 'studio']::text[])");
    const test = billingConfig({ RAZORPAY_KEY_ID: "rzp_test_abcdef12", RAZORPAY_KEY_SECRET: "12345678", RAZORPAY_WEBHOOK_SECRET: "12345678" }, site);
    expect(purchasableSql(test)).toContain("id = any(array[]::text[])");
    expect(purchasableSql(null)).toBe(purchasableSql(test));
  });
});

describe("blog authors", () => {
  it("come from config, validated; an empty list removes every author", () => {
    expect(blogAuthors(JSON.stringify({ blogAuthors: ["Me@Example.com"] }))).toEqual(["me@example.com"]);
    expect(blogAuthors("{}")).toEqual([]);
    expect(() => blogAuthors(JSON.stringify({ blogAuthors: ["x'); drop table blog_posts; --"] }))).toThrow(/Not a valid email/);
    expect(blogAuthorsSql([])).toContain("delete from public.blog_authors;");
    expect(blogAuthorsSql(["a@b.co"])).toContain("insert into public.blog_authors (email) values ('a@b.co')");
  });
});

describe("complimentary plans", () => {
  it("are read from config and validated", () => {
    expect(complimentaryPlans(JSON.stringify({ complimentaryPlans: [{ email: "Me@Example.com", plan: "studio" }] }))).toEqual([{ email: "me@example.com", plan: "studio" }]);
    expect(complimentaryPlans("{}")).toEqual([]);
    expect(() => complimentaryPlans(JSON.stringify({ complimentaryPlans: [{ email: "me@example.com", plan: "free" }] }))).toThrow(/Invalid complimentary/);
    expect(() => complimentaryPlans(JSON.stringify({ complimentaryPlans: [{ email: "x'; drop table plans; --", plan: "studio" }] }))).toThrow();
  });
});
