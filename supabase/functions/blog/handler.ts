/**
 * ScopeFlow blog publishing API, for a tool that posts on the author's behalf.
 *
 *   POST /blog/posts   Authorization: Bearer sfblog_…   (a publishing key from Blog → Publishing keys)
 *   body: { "title", "description", "category", "body" (Markdown), "draft"?: true }
 *   → 201 { id, slug, status, url }
 *
 * The key is hashed here (SHA-256) and checked in the database, which also enforces the author,
 * revocation and the 20-posts-per-day limit. Plain web APIs only (runs in Deno, Node and tests).
 */

export type BlogApiConfig = { supabaseUrl: string; serviceKey: string; siteUrl: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_BODY = 256 * 1024;
export const CATEGORIES: Record<string, string> = {
  strategies: "strategies",
  strategy: "strategies",
  "success-stories": "success-stories",
  "success stories": "success-stories",
  "success story": "success-stories",
  "market-prices": "market-prices",
  "market prices": "market-prices",
  prices: "market-prices",
  tools: "tools",
  tool: "tools",
  news: "news",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });

const HELP = {
  how: "POST /functions/v1/blog/posts with header 'Authorization: Bearer <your publishing key>' and a JSON body.",
  body: {
    title: "5 to 120 characters",
    description: "20 to 200 characters: the summary shown on the blog and in Google",
    category: "strategies | success-stories | market-prices | tools | news",
    body: "the post in Markdown: ## headings, **bold**, *italic*, [links](https://…), - lists, > quotes",
    draft: "optional: true saves a draft instead of publishing",
    cover_image: "optional: the address of a photo uploaded to the blog (from the editor)",
  },
};

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleBlogApi(req: Request, cfg: BlogApiConfig, f: Fetch = fetch): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const route = path.slice(path.lastIndexOf("/") + 1);
  if (req.method === "GET" && (route === "blog" || route === "posts")) return reply(200, HELP);
  if (route !== "posts" || req.method !== "POST") return reply(404, { error: "Not found", ...HELP });
  if (!cfg.serviceKey || !cfg.supabaseUrl) return reply(503, { error: "Publishing isn't set up yet." });

  const m = /^Bearer (sfblog_[A-Za-z0-9_-]{20,100})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return reply(401, { error: "Send your publishing key as 'Authorization: Bearer sfblog_…'." });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "Post too large." });
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw);
  } catch {
    return reply(400, { error: "The body must be JSON.", ...HELP });
  }
  if (!input || typeof input !== "object") return reply(400, { error: "The body must be a JSON object.", ...HELP });
  const category = CATEGORIES[String(input.category ?? "").trim().toLowerCase()] ?? String(input.category ?? "");
  const post = {
    title: String(input.title ?? ""),
    description: String(input.description ?? input.summary ?? ""),
    category,
    body: String(input.body ?? input.content ?? ""),
    slug: typeof input.slug === "string" ? input.slug : undefined,
    publish: input.draft !== true,
  };
  if (typeof input.cover_image === "string" && input.cover_image) {
    const prefix = `${cfg.supabaseUrl}/storage/v1/object/public/blog/`;
    if (!input.cover_image.startsWith(prefix)) return reply(400, { error: "cover_image must be a photo uploaded to the blog (upload it in the editor first)." });
    Object.assign(post, { cover_image: input.cover_image });
  }

  const headers: Record<string, string> = { apikey: cfg.serviceKey, "content-type": "application/json" };
  if (cfg.serviceKey.startsWith("eyJ")) headers.authorization = `Bearer ${cfg.serviceKey}`;
  const res = await f(`${cfg.supabaseUrl}/rest/v1/rpc/blog_publish_with_key`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_key_hash: await sha256Hex(m[1]), p: post }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = String(data?.code ?? "");
    if (code === "28000") return reply(401, { error: "Invalid or revoked publishing key." });
    if (code === "22023") return reply(400, { error: String(data.message), ...HELP });
    if (code === "54000") return reply(429, { error: String(data.message) });
    console.error(`blog publish failed: ${res.status} ${code}`);
    return reply(500, { error: "Couldn't save the post. Please try again." });
  }
  return reply(201, { ...data, url: data.status === "published" ? `${cfg.siteUrl}/blog/${data.slug}` : null });
}

export function blogConfigFromEnv(get: (name: string) => string | undefined): BlogApiConfig {
  return {
    supabaseUrl: String(get("SUPABASE_URL") ?? "").replace(/\/+$/, ""),
    serviceKey: get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    siteUrl: String(get("SITE_URL") || "https://scopeflow.in").replace(/\/+$/, ""),
  };
}
