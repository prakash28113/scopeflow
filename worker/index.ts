/**
 * ScopeFlow Worker. Intentionally tiny and secret-free:
 *  - static files and browser page navigations are served by static assets and never reach
 *    this script;
 *  - `fetch` sees only requests to paths with no file that the platform didn't classify as a
 *    navigation (e.g. some in-app browsers, link previewers, older webviews). If they ask for
 *    HTML it serves the app shell with the same security headers as the static pages
 *    (the client portal stays noindex/no-store); anything else gets a JSON 404;
 *  - `scheduled` pings Supabase twice a day so a free project isn't paused.
 */
import { PORTAL_HEADERS, PRIVATE_PATHS, pageHeaders } from "../build/security-headers";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TURNSTILE_ENABLED?: string;
  GOOGLE_SIGNIN_ENABLED?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
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

/** True for a GET/HEAD that wants a page (not a file, not an API call). */
export function wantsPage(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(pathname)) return false;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

export async function servePage(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS || !wantsPage(request)) return json({ error: "Not found" }, 404);
  let supabaseUrl: string;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL).origin;
  } catch {
    return json({ error: "Not found" }, 404);
  }
  const url = new URL(request.url);
  const shell = await env.ASSETS.fetch(new Request(new URL("/", url), { method: request.method }));
  if (!shell.ok) return json({ error: "Not found" }, 404);
  const headers = new Headers({ "content-type": shell.headers.get("content-type") ?? "text/html; charset=utf-8" });
  for (const [k, v] of Object.entries(pageHeaders({ supabaseUrl, turnstile: env.TURNSTILE_ENABLED === "true", google: env.GOOGLE_SIGNIN_ENABLED === "true" }))) headers.set(k, v);
  if ((PRIVATE_PATHS as readonly string[]).includes(url.pathname)) for (const [k, v] of Object.entries(PORTAL_HEADERS)) headers.set(k, v);
  else headers.set("Cache-Control", "no-cache");
  return new Response(shell.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return servePage(request, env);
  },
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      keepAlive(env).then((ok) => {
        if (!ok) console.error("keep-alive: Supabase health check failed");
      }),
    );
  },
};
