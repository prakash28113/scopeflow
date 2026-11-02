import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { handleBlogApi } from "../../supabase/functions/blog/handler";

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const cfg = { supabaseUrl: SUPA, serviceKey: "eyJservice.key.x", siteUrl: "https://scopeflow.in" };
const KEY = "sfblog_" + "a".repeat(43);
const good = { title: "Pricing logos in 2026", description: "How much freelancers in India charge for a logo, and why.", category: "Market prices", body: "## Hello" };

function world(result: { status: number; body: unknown } = { status: 200, body: { id: "p1", slug: "pricing-logos-in-2026", status: "published" } }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(result.body), { status: result.status });
  };
  return { calls, f };
}
const post = (body: unknown, auth = `Bearer ${KEY}`, w = world()) =>
  handleBlogApi(new Request(`${SUPA}/functions/v1/blog/posts`, { method: "POST", headers: { authorization: auth }, body: typeof body === "string" ? body : JSON.stringify(body) }), cfg, w.f).then(async (r) => ({ status: r.status, body: await r.json(), w }));

describe("blog publishing API", () => {
  it("publishes with a key: sends only the key's hash, maps friendly categories, returns the post's address", async () => {
    const r = await post(good);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: "p1", slug: "pricing-logos-in-2026", status: "published", url: "https://scopeflow.in/blog/pricing-logos-in-2026" });
    expect(r.w.calls[0].url).toBe(`${SUPA}/rest/v1/rpc/blog_publish_with_key`);
    expect(r.w.calls[0].body).toEqual({
      p_key_hash: createHash("sha256").update(KEY).digest("hex"),
      p: { title: good.title, description: good.description, category: "market-prices", body: "## Hello", publish: true },
    });
    expect(JSON.stringify(r.w.calls)).not.toContain(KEY);
  });

  it("saves a draft when asked", async () => {
    const r = await post({ ...good, draft: true }, undefined, world({ status: 200, body: { id: "p2", slug: "x", status: "draft" } }));
    expect(r.w.calls[0].body.p).toMatchObject({ publish: false });
    expect(r.body.url).toBeNull();
  });

  it("refuses missing or malformed keys without touching the database", async () => {
    for (const auth of ["", "Bearer nope", `Basic ${KEY}`]) {
      const r = await post(good, auth);
      expect(r.status).toBe(401);
      expect(r.w.calls).toHaveLength(0);
    }
    expect((await post("not json")).status).toBe(400);
  });

  it("explains database refusals", async () => {
    expect((await post(good, undefined, world({ status: 401, body: { code: "28000", message: "Invalid or revoked publishing key." } }))).status).toBe(401);
    const bad = await post(good, undefined, world({ status: 400, body: { code: "22023", message: "Choose a category." } }));
    expect(bad).toMatchObject({ status: 400, body: { error: "Choose a category." } });
    expect((await post(good, undefined, world({ status: 400, body: { code: "54000", message: "Daily limit reached" } }))).status).toBe(429);
  });

  it("describes itself on GET", async () => {
    const r = await handleBlogApi(new Request(`${SUPA}/functions/v1/blog`), cfg, world().f);
    expect((await r.json()).body.category).toMatch(/success-stories/);
  });
});
