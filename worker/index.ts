/**
 * ScopeFlow Worker. Intentionally tiny and secret-free:
 *  - static files and page navigations never reach this script (served by assets);
 *  - `fetch` only sees non-navigation requests to paths with no file → 404;
 *  - `scheduled` pings Supabase once a day so a free project isn't paused.
 */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-content-type-options": "nosniff", "cache-control": "no-store" },
  });

export async function keepAlive(env: Env, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!env.SUPABASE_URL?.startsWith("https://") && !env.SUPABASE_URL?.startsWith("http://127.0.0.1")) return false;
  const res = await fetcher(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/health`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: "{}",
  });
  return res.ok;
}

export default {
  async fetch(): Promise<Response> {
    return json({ error: "Not found" }, 404);
  },
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      keepAlive(env).then((ok) => {
        if (!ok) console.error("keep-alive: Supabase health check failed");
      }),
    );
  },
};
