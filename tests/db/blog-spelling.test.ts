/** T2-02: the owner's surname and the brand are spelled right on every blog post and publishing key. */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { as, createDb, createUser, readMigration, service, type Role } from "./harness";

type Json = Record<string, unknown>;
const WRONG = "Mummidisett" + "y";
const BRAND_WRONG = "Scope" + "flow";
const NAME = "20261121000000_blog_spelling";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const post = (o: Json = {}) =>
  JSON.stringify({ title: "How to write a freelance quotation", description: "What goes into a quotation an Indian client will sign, with an example.", category: "strategies", body: "## Start\n\nWrite it down.", publish: true, ...o });

describe("blog spelling", () => {
  it("corrects stored posts and keys, leaves domains and emails alone, and can't regress", async () => {
    const db = await createDb({ upTo: "20261120000000_billing_activation_needs_payment.sql" });
    const rpc = async <T = Json>(role: Role, fn: string, args: unknown[]) =>
      (await as<{ r: T }>(db, role, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))[0].r;
    const author = await createUser(db, "writer@example.com", `Prakash ${WRONG}`);
    await db.query("insert into blog_authors (email) values ('writer@example.com')");
    // The state production was in: a key created while the profile had the old spelling.
    const k = await rpc<{ id: string; key: string }>(author, "create_blog_key", ["Grok"]);
    expect((await db.query<Json>("select author_name from blog_api_keys")).rows[0].author_name).toBe(`Prakash ${WRONG}`);
    const body = `${BRAND_WRONG} keeps the scope agreed. Try ${BRAND_WRONG}: it's at scopeflow.in or https://scopeflow.in/pricing; write to help@scopeflow.in. (${BRAND_WRONG})`;
    await rpc(service, "blog_publish_with_key", [sha(k.key), post({ title: `Freelance quotation in India with ${BRAND_WRONG}`, description: `How ${BRAND_WRONG} turns a quotation into an approved scope, step by step.`, body })]);
    expect((await db.query<Json>("select author_name from blog_posts")).rows[0].author_name).toBe(`Prakash ${WRONG}`);

    await db.exec(readMigration(`${NAME}.sql`));
    await db.exec(readMigration(`${NAME}.sql`)); // safe to re-run
    const all = JSON.stringify([(await db.query("select * from blog_posts")).rows, (await db.query("select author_name from blog_api_keys")).rows]);
    expect(all).not.toContain(WRONG);
    expect(all).not.toMatch(new RegExp(`\\b${BRAND_WRONG}\\b(?!\\.in)`));
    const [p] = (await db.query<Json>("select title, description, body, author_name from blog_posts")).rows;
    expect(p.author_name).toBe("Prakash Mummidisetti");
    expect(p.title).toBe("Freelance quotation in India with ScopeFlow");
    expect(p.description).toBe("How ScopeFlow turns a quotation into an approved scope, step by step.");
    expect(p.body).toBe("ScopeFlow keeps the scope agreed. Try ScopeFlow: it's at scopeflow.in or https://scopeflow.in/pricing; write to help@scopeflow.in. (ScopeFlow)");
    expect((await db.query<Json>("select author_name from blog_api_keys")).rows[0].author_name).toBe("Prakash Mummidisetti");

    // A new post through the key, and one from the editor by a profile still spelled the old way.
    const viaKey = await rpc<Json>(service, "blog_publish_with_key", [sha(k.key), post({ title: "Second post through the key", description: "A second post published with the same key, to check the author name." })]);
    const viaEditor = await rpc<Json>(author, "save_blog_post", [null, post({ title: `Written in the editor about ${BRAND_WRONG}`, description: "A post saved from the editor by the same author, to check the name." })]);
    const rows = (await db.query<Json>("select title, author_name from blog_posts where id = any($1::uuid[])", [[viaKey.id, viaEditor.id]])).rows;
    expect(rows.map((r) => r.author_name)).toEqual(["Prakash Mummidisetti", "Prakash Mummidisetti"]);
    expect(rows.map((r) => r.title).sort()).toEqual(["Second post through the key", "Written in the editor about ScopeFlow"]);
    // Even a direct write can't store it.
    await db.query("update blog_api_keys set author_name = $1", [`Prakash ${WRONG}`]);
    expect((await db.query<Json>("select author_name from blog_api_keys")).rows[0].author_name).toBe("Prakash Mummidisetti");
    // Nobody but the database itself can call the helpers.
    const [g] = (await db.query<Json>("select has_function_privilege('anon', 'public._brand_spelling(text)', 'EXECUTE') as a, has_function_privilege('authenticated', 'public._brand_spelling(text)', 'EXECUTE') as b")).rows;
    expect(g).toEqual({ a: false, b: false });

    // Rollback removes the triggers, keeps the corrected text, and the migration re-applies.
    const down = readFileSync(new URL(`../../supabase/rollback/${NAME}_down.sql`, import.meta.url), "utf8");
    await db.exec(down);
    await db.exec(down);
    expect((await db.query("select 1 from pg_trigger where tgname in ('blog_posts_a_spelling', 'blog_api_keys_spelling')")).rows).toEqual([]);
    expect((await db.query<Json>("select author_name from blog_posts limit 1")).rows[0].author_name).toBe("Prakash Mummidisetti");
    await db.exec(readMigration(`${NAME}.sql`));
  });
});
