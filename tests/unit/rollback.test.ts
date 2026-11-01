import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
// @ts-expect-error — plain ESM script
import { rollback, rollbackPlan } from "../../scripts/ci/rollback.mjs";

const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
const rollbacks = readdirSync("supabase/rollback").filter((f) => f.endsWith(".sql"));

describe("rollback automation", () => {
  it("every migration after v1.0 ships a rollback script, and the plan picks the newest", () => {
    for (const m of migrations.filter((x) => x > "20261031000000_scopeflow_schema.sql")) {
      expect(rollbacks).toContain(m.replace(/\.sql$/, "_down.sql"));
    }
    const newest = [...migrations].sort().at(-1)!;
    expect(rollbackPlan(migrations, rollbacks)).toEqual({ migration: newest, script: newest.replace(/\.sql$/, "_down.sql") });
    expect(() => rollbackPlan(["20300101000000_x.sql"], rollbacks)).toThrow(/No rollback script/);
  });

  const files = {
    publicConfig: readFileSync("config/public-supabase.json", "utf8"),
    migrations,
    rollbacks,
    read: (n: string) => readFileSync(`supabase/rollback/${n}`, "utf8"),
  };

  it("app rollback calls wrangler rollback non-interactively and never touches the database", async () => {
    const execs: string[][] = [];
    const calls: string[] = [];
    const r = await rollback({
      env: { ROLLBACK_TARGET: "rollback-app", CLOUDFLARE_API_TOKEN: "cf" },
      fetch: async (u: string) => (calls.push(u), new Response("{}")),
      exec: (_c: string, a: string[]) => (execs.push(a), "ok"),
      log: () => {},
      summary: () => {},
      files,
    });
    expect(r).toBe("app-rolled-back");
    expect(execs[0].slice(0, 3)).toEqual(["wrangler", "rollback", "--yes"]);
    expect(calls).toEqual([]);
  });

  it("database rollback needs the typed confirmation, then runs the newest down script", async () => {
    const base = { fetch: async () => new Response("[]"), exec: () => "", log: () => {}, summary: () => {}, files };
    await expect(rollback({ ...base, env: { ROLLBACK_TARGET: "rollback-database", SUPABASE_ACCESS_TOKEN: "t", ROLLBACK_CONFIRM: "yes" } })).rejects.toThrow(/Type ROLLBACK/);
    const bodies: string[] = [];
    const r = await rollback({
      ...base,
      fetch: async (u: string, init: { body: string }) => (bodies.push(u, JSON.parse(init.body).query), new Response("[]")),
      env: { ROLLBACK_TARGET: "rollback-database", SUPABASE_ACCESS_TOKEN: "t", ROLLBACK_CONFIRM: "ROLLBACK" },
    });
    expect(r).toBe("database-rolled-back");
    expect(bodies[0]).toBe("https://api.supabase.com/v1/projects/esixrjouserdayxxezid/database/query");
    expect(bodies[1]).toMatch(/^-- Rollback for /);
  });
});
