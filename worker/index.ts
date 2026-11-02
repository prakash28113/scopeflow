/**
 * ScopeFlow Worker. Intentionally tiny and secret-free:
 *  - static files and browser page navigations are served by static assets and never reach
 *    this script;
 *  - `fetch` sees only requests to paths with no file that the platform didn't classify as a
 *    navigation (e.g. some in-app browsers, link previewers, older webviews). If they ask for
 *    HTML it serves the app shell with the same security headers as the static pages
 *    (the client portal stays noindex/no-store); anything else gets a JSON 404;
 *  - blog pages (/blog, /blog/<post>, /blog/rss.xml, /sitemap.xml) always come here first
 *    (assets.run_worker_first) and are rendered with the posts from the database (worker/blog.ts);
 *  - `scheduled` pings Supabase twice a day so a free project isn't paused.
 */
import { PORTAL_HEADERS, PRIVATE_PATHS, pageHeaders } from "../build/security-headers";
import { blogRoute, fillShell, getPost, listPage, listPosts, notFoundPage, postPage, rss, sitemap } from "./blog";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TURNSTILE_ENABLED?: string;
  GOOGLE_SIGNIN_ENABLED?: string;
  BILLING_ENABLED?: string;
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

/** A path with no file, so static assets answer with the app shell (index.html). */
const SHELL_PROBE = "/__app-shell";

/** The app shell with the security headers every page gets. */
async function shell(request: Request, env: Env): Promise<{ html: Response; headers: Headers } | null> {
  if (!env.ASSETS) return null;
  let supabaseUrl: string;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL).origin;
  } catch {
    return null;
  }
  const url = new URL(request.url);
  // The app shell is what static assets serve for an unknown page address (single-page-application handling).
  // Not "/" (rewritten to the prerendered home page by _redirects) and not "/index.html" (redirects to "/").
  const html = await env.ASSETS.fetch(
    new Request(new URL(SHELL_PROBE, url), { method: "GET", redirect: "manual", headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } }),
  );
  if (!html.ok) return null;
  const headers = new Headers({ "content-type": html.headers.get("content-type") ?? "text/html; charset=utf-8" });
  for (const [k, v] of Object.entries(pageHeaders({ supabaseUrl, turnstile: env.TURNSTILE_ENABLED === "true", google: env.GOOGLE_SIGNIN_ENABLED === "true", razorpay: env.BILLING_ENABLED === "true" }))) headers.set(k, v);
  return { html, headers };
}

export async function servePage(request: Request, env: Env): Promise<Response> {
  if (!wantsPage(request)) return json({ error: "Not found" }, 404);
  const s = await shell(request, env);
  if (!s) return json({ error: "Not found" }, 404);
  const url = new URL(request.url);
  if ((PRIVATE_PATHS as readonly string[]).includes(url.pathname)) for (const [k, v] of Object.entries(PORTAL_HEADERS)) s.headers.set(k, v);
  else s.headers.set("Cache-Control", "no-cache");
  return new Response(request.method === "HEAD" ? null : s.html.body, { status: 200, headers: s.headers });
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Blog pages, feed and sitemap, rendered with the posts. Falls back to the plain shell if the database is unreachable. */
export async function serveBlog(request: Request, env: Env, f: Fetcher = fetch): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.pathname.length > 5 && url.pathname.endsWith("/") && url.pathname.startsWith("/blog")) {
    return Response.redirect(new URL(url.pathname.replace(/\/+$/, "") + url.search, url).toString(), 301);
  }
  const route = blogRoute(url.pathname);
  if (!route) return null;
  const body = (text: string) => (request.method === "HEAD" ? null : text);

  if (route.kind === "sitemap" || route.kind === "rss") {
    try {
      const posts = await listPosts(env, f);
      return new Response(body(route.kind === "sitemap" ? sitemap(posts) : rss(posts)), {
        headers: {
          "content-type": route.kind === "sitemap" ? "application/xml; charset=utf-8" : "application/rss+xml; charset=utf-8",
          "cache-control": "public, max-age=600",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (e) {
      console.error(String(e));
      // The build's static sitemap (public pages only) is better than nothing.
      if (route.kind === "sitemap" && env.ASSETS) return env.ASSETS.fetch(new Request(url, { method: request.method }));
      return json({ error: "Feed unavailable" }, 503);
    }
  }

  const s = await shell(request, env);
  if (!s) return json({ error: "Not found" }, 404);
  s.headers.set("Cache-Control", "no-cache");
  const shellHtml = await s.html.text();
  if (route.kind === "app") return new Response(body(shellHtml), { status: 200, headers: s.headers });
  try {
    if (route.kind === "list") {
      return new Response(body(fillShell(shellHtml, listPage(await listPosts(env, f)))), { status: 200, headers: s.headers });
    }
    const [post, posts] = await Promise.all([getPost(env, f, route.slug), listPosts(env, f)]);
    if (!post) return new Response(body(fillShell(shellHtml, notFoundPage(route.slug))), { status: 404, headers: s.headers });
    return new Response(body(fillShell(shellHtml, postPage(post, posts))), { status: 200, headers: s.headers });
  } catch (e) {
    console.error(String(e));
    // The app loads the posts itself.
    return new Response(body(shellHtml), { status: 200, headers: s.headers });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await serveBlog(request, env)) ?? servePage(request, env);
  },
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      keepAlive(env).then((ok) => {
        if (!ok) console.error("keep-alive: Supabase health check failed");
      }),
    );
  },
};
