/**
 * Blog: public reads only of published posts, authors-only writing, stable addresses,
 * and publishing keys (hashed, revocable, rate-limited) for a tool that posts on the author's behalf.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, service, type Role } from "./harness";

type Json = Record<string, unknown>;
let db: PGlite;
let author: Role & { id: string };
let reader: Role & { id: string };

async function rpc<T = Json>(role: Role, fn: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
const post = (o: Json = {}) =>
  JSON.stringify({
    title: "How to price a logo project",
    description: "A simple way to work out a fair price for logo work, with examples.",
    category: "strategies",
    body: "## Start with time\n\nCount the hours.",
    publish: true,
    ...o,
  });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const publicPosts = (role: Role = anon) => as<Json>(db, role, "select slug, title, status from blog_posts order by published_at");

beforeAll(async () => {
  db = await createDb();
  author = await createUser(db, "writer@example.com", "Prakash M");
  reader = await createUser(db, "reader@example.com", "Reader");
  await db.query("insert into blog_authors (email) values ('writer@example.com')");
});

describe("writing", () => {
  it("only authors can write; everyone else is refused", async () => {
    expect(await rpc(author, "is_blog_author")).toBe(true);
    expect(await rpc(reader, "is_blog_author")).toBe(false);
    await expect(rpc(reader, "save_blog_post", [null, post()])).rejects.toThrow(/Only blog authors/);
    await expect(rpc(reader, "blog_my_posts")).rejects.toThrow(/Only blog authors/);
    await expect(as(db, anon, "select public.save_blog_post(null, '{}')")).rejects.toThrow(/permission denied/);
    await expect(as(db, author, "insert into blog_posts (slug, title, description, category, body, author_name) values ('x-x','xxxxx','x','news','x','x')")).rejects.toThrow(/permission denied/);
    await expect(as(db, author, "select * from blog_authors")).rejects.toThrow(/permission denied/);
  });

  it("publishes with an address made from the title, and keeps it after edits", async () => {
    const r = await rpc<Json>(author, "save_blog_post", [null, post()]);
    expect(r).toMatchObject({ slug: "how-to-price-a-logo-project", status: "published" });
    const again = await rpc<Json>(author, "save_blog_post", [null, post()]);
    expect(again.slug).toBe("how-to-price-a-logo-project-2");
    const edited = await rpc<Json>(author, "save_blog_post", [r.id, post({ title: "Pricing logo projects in 2026" })]);
    expect(edited.slug).toBe("how-to-price-a-logo-project"); // published → links keep working
    const [row] = await as<Json>(db, anon, "select title, author_name from blog_posts where slug = 'how-to-price-a-logo-project'");
    expect(row).toEqual({ title: "Pricing logo projects in 2026", author_name: "Prakash M" });
  });

  it("validates the post with plain explanations", async () => {
    await expect(rpc(author, "save_blog_post", [null, post({ title: "Hi" })])).rejects.toThrow(/title of 5 to 120/);
    await expect(rpc(author, "save_blog_post", [null, post({ description: "short" })])).rejects.toThrow(/summary of 20 to 200/);
    await expect(rpc(author, "save_blog_post", [null, post({ category: "gossip" })])).rejects.toThrow(/Choose a category/);
    await expect(rpc(author, "save_blog_post", [null, post({ body: " " })])).rejects.toThrow(/Write the post/);
  });

  it("drafts stay private until published, and unpublishing hides a post", async () => {
    const d = await rpc<Json>(author, "save_blog_post", [null, post({ title: "Draft about rates", publish: false })]);
    expect(d.status).toBe("draft");
    expect((await publicPosts()).map((p) => p.slug)).not.toContain(d.slug);
    expect((await publicPosts(reader)).map((p) => p.slug)).not.toContain(d.slug);
    expect((await rpc<Json[]>(author, "blog_my_posts")).map((p) => p.slug)).toContain(d.slug);
    await rpc(author, "save_blog_post", [d.id, post({ title: "Draft about rates", publish: true })]);
    expect((await publicPosts()).map((p) => p.slug)).toContain(d.slug);
    await rpc(author, "save_blog_post", [d.id, post({ title: "Draft about rates", publish: false })]);
    expect((await publicPosts()).map((p) => p.slug)).not.toContain(d.slug);
    await rpc(author, "delete_blog_post", [d.id]);
    await expect(rpc(author, "delete_blog_post", [d.id])).rejects.toThrow(/not found/);
  });
});

describe("publishing keys", () => {
  it("are shown once, stored only as a hash, and publish as the author", async () => {
    const k = await rpc<{ id: string; key: string; label: string }>(author, "create_blog_key", ["Grok"]);
    expect(k.key).toMatch(/^sfblog_[A-Za-z0-9_-]{40,}$/);
    const [stored] = (await db.query<Json>("select key_hash from blog_api_keys where id = $1", [k.id])).rows;
    expect(stored.key_hash).toBe(sha(k.key));
    expect(JSON.stringify(await rpc(author, "blog_my_keys"))).not.toContain(k.key);

    const r = await rpc<Json>(service, "blog_publish_with_key", [sha(k.key), post({ title: "Freelance rates in Hyderabad" })]);
    expect(r).toMatchObject({ slug: "freelance-rates-in-hyderabad", status: "published" });
    expect((await rpc<Json[]>(author, "blog_my_keys"))[0]).toMatchObject({ label: "Grok", revoked: false, last_used_at: expect.any(String) });
    // Drafts are possible too.
    expect(await rpc<Json>(service, "blog_publish_with_key", [sha(k.key), post({ title: "A draft from a tool", publish: false })])).toMatchObject({ status: "draft" });
  });

  it("can't be used directly by app users, and stop working when revoked or the author is removed", async () => {
    const k = await rpc<{ id: string; key: string }>(author, "create_blog_key", ["Automation"]);
    await expect(as(db, author, "select public.blog_publish_with_key($1, $2)", [sha(k.key), post()])).rejects.toThrow(/permission denied/);
    await expect(rpc(reader, "create_blog_key", ["Mine"])).rejects.toThrow(/Only blog authors/);
    await expect(rpc(service, "blog_publish_with_key", [sha("sfblog_guess"), post()])).rejects.toThrow(/Invalid or revoked/);
    await expect(rpc(reader, "revoke_blog_key", [k.id])).rejects.toThrow(/Only blog authors/);
    await rpc(author, "revoke_blog_key", [k.id]);
    await expect(rpc(service, "blog_publish_with_key", [sha(k.key), post()])).rejects.toThrow(/Invalid or revoked/);
  });

  it("allow at most 20 posts per key per day, and 5 active keys per author", async () => {
    const k = await rpc<{ key: string }>(author, "create_blog_key", ["Busy"]);
    await db.query("update blog_api_keys set window_posts = 19 where key_hash = $1", [sha(k.key)]);
    await rpc(service, "blog_publish_with_key", [sha(k.key), post({ title: "Twentieth post today" })]);
    await expect(rpc(service, "blog_publish_with_key", [sha(k.key), post({ title: "Twenty-first post" })])).rejects.toThrow(/Daily limit/);
    // A failed post doesn't use up the allowance.
    await db.query("update blog_api_keys set window_posts = 0 where key_hash = $1", [sha(k.key)]);
    await expect(rpc(service, "blog_publish_with_key", [sha(k.key), post({ title: "x" })])).rejects.toThrow(/title/);
    const [{ window_posts }] = (await db.query<Json>("select window_posts from blog_api_keys where key_hash = $1", [sha(k.key)])).rows;
    expect(window_posts).toBe(0);
    const active = (await rpc<Json[]>(author, "blog_my_keys")).filter((x) => !x.revoked).length;
    for (let i = active; i < 5; i++) await rpc(author, "create_blog_key", [`Key ${i}`]);
    await expect(rpc(author, "create_blog_key", ["One too many"])).rejects.toThrow(/5 active keys/);
  });
});

describe("rollback", () => {
  it("removes the blog and re-applies cleanly", async () => {
    const fresh = await createDb();
    const down = readFileSync(new URL("../../supabase/rollback/20261113000000_blog_down.sql", import.meta.url), "utf8");
    await fresh.exec(down);
    await fresh.exec(down);
    expect((await fresh.query("select to_regclass('public.blog_posts') as t")).rows).toEqual([{ t: null }]);
    await fresh.exec(readFileSync(new URL("../../supabase/migrations/20261113000000_blog.sql", import.meta.url), "utf8"));
  });
});
