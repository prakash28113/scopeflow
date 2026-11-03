/**
 * Brand & growth: paid-plan features (expenses read-only on Free), my_plan features, default SAC,
 * the owner's name, sign-up source capture and the admin-only source report.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createDb, createUser, readMigration, service, type Role } from "./harness";

type Json = Record<string, unknown>;
let db: PGlite;

async function rpcOn<T = Json>(d: PGlite, role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(d, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
const rpc = <T = Json>(role: Role, fn: string, args: unknown[]) => rpcOn<T>(db, role, fn, args);
const expense = JSON.stringify({ spent_on: "2026-10-15", category: "software", description: "Figma", amount_cents: 120000 });

beforeAll(async () => {
  db = await createDb();
});

describe("paid-plan features", () => {
  it("Free accounts can't add or delete expenses, but keep and see the ones they have", async () => {
    const free = await createUser(db, "free@example.com", "Free User", { plan: "free" });
    await rpc(free, "complete_onboarding", ["Free User", "", "INR"]);
    // An expense from before the change (or from a lapsed paid plan).
    await db.query("insert into expenses (owner_id, spent_on, category, amount_cents, currency) values ($1, '2026-10-01', 'software', 50000, 'INR')", [free.id]);
    await expect(rpc(free, "add_expense", [expense])).rejects.toThrow("Expenses are available on Solo, ₹499/month.");
    const [old] = await as<{ id: string }>(db, free, "select id from expenses");
    await expect(rpc(free, "delete_expense", [old.id])).rejects.toThrow(/available on Solo/);
    expect(await as(db, free, "select amount_cents from expenses")).toEqual([{ amount_cents: 50000 }]);
    const plan = await rpc<Json>(free, "my_plan", []);
    expect(plan.features).toEqual({ analytics: false, exports: false });
  });

  it("Solo and Studio can, and a lapsed plan becomes read-only again", async () => {
    const paid = await createUser(db, "paid@example.com", "Paid User");
    await rpc(paid, "complete_onboarding", ["Paid User", "", "INR"]);
    const id = await rpc<string>(paid, "add_expense", [expense]);
    expect((await rpc<Json>(paid, "my_plan", [])).features).toEqual({ analytics: true, exports: true });
    await db.query("select public.admin_set_plan('paid@example.com', 'solo', 'active', 'month', now() + interval '30 days', 'test')");
    expect((await rpc<Json>(paid, "my_plan", [])).features).toEqual({ analytics: true, exports: true });
    await db.query("select public.admin_set_plan('paid@example.com', 'free', 'free', null, null, 'test')");
    await expect(rpc(paid, "delete_expense", [id])).rejects.toThrow(/available on Solo/);
    expect(await as(db, paid, "select count(*)::int as n from expenses")).toEqual([{ n: 1 }]);
  });
});

describe("defaults and names", () => {
  it("new accounts get SAC 998314, which they can change", async () => {
    const u = await createUser(db, "sac@example.com", "Sac User");
    await rpc(u, "complete_onboarding", ["Sac User", "", "INR"]);
    expect(await as(db, u, "select sac_code from profiles")).toEqual([{ sac_code: "998314" }]);
    await rpc(u, "set_invoice_details", [JSON.stringify({ sac_code: "998391" })]);
    expect(await as(db, u, "select sac_code from profiles")).toEqual([{ sac_code: "998391" }]);
  });

  it("spells the owner's surname Mummidisetty on posts and the profile", async () => {
    const d = await createDb({ upTo: "20261115000000_gst_invoicing.sql" });
    await createUser(d, "prakashmummidisetti@gmail.com", "Prakash Mummidisetti");
    await d.query("insert into blog_posts (slug, title, description, category, body, status, author_name, published_at) values ('a-post', 'A post title here', 'A short summary of at least twenty characters.', 'strategies', 'Body text that is long enough to publish here.', 'published', 'Prakash Mummidisetti', now())");
    await d.query("update profiles set sac_code = null");
    await d.exec(readMigration("20261116000000_brand_growth.sql"));
    expect((await d.query<Json>("select author_name from blog_posts")).rows).toEqual([{ author_name: "Prakash Mummidisetty" }]);
    expect((await d.query<Json>("select full_name, sac_code from profiles")).rows).toEqual([{ full_name: "Prakash Mummidisetty", sac_code: "998314" }]);
  });
});

describe("sign-up source", () => {
  it("saves the first visit's tags once, cleaned and trimmed", async () => {
    const u = await createUser(db, "utm@example.com", "Utm User", { plan: "free" });
    await rpc(u, "set_signup_source", [JSON.stringify({ utm_source: "instagram", utm_medium: "social", utm_campaign: "launch<script>", referrer: "https://www.instagram.com/" })]);
    await rpc(u, "set_signup_source", [JSON.stringify({ utm_source: "google" })]);
    expect(await as(db, u, "select signup_utm_source, signup_utm_medium, signup_utm_campaign, signup_referrer from profiles")).toEqual([
      { signup_utm_source: "instagram", signup_utm_medium: "social", signup_utm_campaign: "launchscript", signup_referrer: "https://www.instagram.com/" },
    ]);
    const long = await createUser(db, "long@example.com", "Long", { plan: "free" });
    await rpc(long, "set_signup_source", [JSON.stringify({ utm_source: "x".repeat(500), referrer: "https://news.ycombinator.com/item?id=1" })]);
    const [row] = await as<Json>(db, long, "select signup_utm_source, signup_referrer from profiles");
    expect((row.signup_utm_source as string).length).toBe(100);
  });

  it("the source report counts sign-ups and paying accounts, for admins only", async () => {
    const d = await createDb();
    const a = await createUser(d, "a@example.com", "A", { plan: "free" });
    const b = await createUser(d, "b@example.com", "B", { plan: "free" });
    await createUser(d, "c@example.com", "C", { plan: "free" });
    await rpcOn(d, a, "set_signup_source", [JSON.stringify({ utm_source: "instagram", utm_medium: "social" })]);
    await rpcOn(d, b, "set_signup_source", [JSON.stringify({ referrer: "https://www.google.com/search?q=scopeflow" })]);
    // b pays through Razorpay; a complimentary plan wouldn't count.
    await d.query("update subscriptions set plan_id = 'solo', status = 'active', provider = 'razorpay', provider_subscription_id = 'sub_1' where owner_id = $1", [b.id]);
    const rows = (await d.query<Json>("select source, medium, signups::int, paid::int from admin_signup_sources() order by source")).rows;
    expect(rows).toEqual([
      { source: "(direct)", medium: "", signups: 1, paid: 0 },
      { source: "google.com", medium: "", signups: 1, paid: 1 },
      { source: "instagram", medium: "social", signups: 1, paid: 0 },
    ]);
    await expect(as(d, a, "select * from admin_signup_sources()")).rejects.toThrow(/permission denied/);
    await expect(as(d, service, "select * from admin_signup_sources()")).rejects.toThrow(/permission denied/);
  });

  it("rolls back (twice) and re-applies", async () => {
    const d = await createDb();
    const { readFileSync } = await import("node:fs");
    const down = readFileSync(new URL("../../supabase/rollback/20261116000000_brand_growth_down.sql", import.meta.url), "utf8");
    await d.exec(down);
    await d.exec(down);
    expect((await d.query("select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'signup_referrer'")).rows).toEqual([]);
    const u = await createUser(d, "back@example.com", "Back", { plan: "free" });
    await rpcOn(d, u, "add_expense", [expense]); // no plan check after rollback
    await d.exec(readMigration("20261116000000_brand_growth.sql"));
  });
});

describe("blog posts", () => {
  it("each published post has its own title and summary", async () => {
    const d = await createDb();
    const ins = (slug: string, title: string, description: string, status = "published") =>
      d.query("insert into blog_posts (slug, title, description, category, body, status, author_name, published_at) values ($1, $2, $3, 'strategies', 'Body text that is long enough to publish here.', $4, 'A', now())", [slug, title, description, status]);
    await ins("one", "Pricing your first project", "How to price a first freelance project in India.");
    await expect(ins("two", "pricing your first project ", "A different summary for the second post.")).rejects.toThrow(/already has this title/);
    await expect(ins("three", "Another title entirely", "How to price a first freelance project in India.")).rejects.toThrow(/already has this summary/);
    await ins("draft", "Pricing your first project", "Drafts can share it until published.", "draft");
    await expect(d.query("update blog_posts set status = 'published' where slug = 'draft'")).rejects.toThrow(/already has this title/);
  });
});
