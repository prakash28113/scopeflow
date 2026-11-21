import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module (scripts run by GitHub Actions)
import { checkHistory, checksum, migrationSql, prepare, rollbackSql } from "../../scripts/ci/migrations.mjs";

const N1 = "20261201000000_first.sql";
const N2 = "20261202000000_second.sql";

describe("migration SQL", () => {
  it("runs the file, then its history row, inside ONE transaction (the file's own begin/commit are removed)", () => {
    const sql = migrationSql(N1, "begin;\ncreate table t (id int);\ncommit;\n");
    expect(sql.match(/^begin;$/gim)).toHaveLength(1);
    expect(sql.match(/^commit;$/gim)).toHaveLength(1);
    expect(sql.indexOf("create table t")).toBeLessThan(sql.indexOf("insert into scopeflow_admin.applied_migrations"));
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain(checksum("begin;\ncreate table t (id int);\ncommit;\n"));
  });

  it("keeps plpgsql blocks and strings alone", () => {
    const body = "begin;\ncreate function f() returns int language plpgsql as $$\nbegin\n  return 1;\nend $$;\ncommit;";
    const out = prepare(N1, body);
    expect(out).toContain("begin\n  return 1;");
    expect(out).not.toMatch(/^begin;$/im);
  });

  it("refuses statements that can't run in a transaction, and bad names", () => {
    expect(() => prepare(N1, "create index concurrently i on t (id);")).toThrow(/can't run inside a transaction/);
    expect(() => prepare(N1, "vacuum t;")).toThrow(/can't run inside/);
    expect(() => prepare(N1, "rollback;")).toThrow(/can't run inside/);
    expect(() => prepare("../evil.sql", "select 1")).toThrow(/Unexpected migration file name/);
    expect(() => migrationSql("x'; drop table y; --.sql", "select 1")).toThrow(/Unexpected/);
  });

  it("every real migration and rollback in the repo can be wrapped", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    for (const dir of ["supabase/migrations", "supabase/rollback"]) {
      for (const f of readdirSync(dir).filter((x) => /^[0-9]{14}_.*\.sql$/.test(x))) {
        const body = readFileSync(`${dir}/${f}`, "utf8");
        const name = f.replace(/_down\.sql$/, ".sql");
        expect(() => prepare(name, body), `${dir}/${f}`).not.toThrow();
      }
    }
  });

  it("rollback: guarded, and removes the history row in the same transaction", () => {
    const sql = rollbackSql(N2, "begin;\ndrop table t;\ncommit;");
    expect(sql.match(/^begin;$/gim)).toHaveLength(1);
    expect(sql.indexOf("drop table t")).toBeLessThan(sql.indexOf("delete from scopeflow_admin.applied_migrations"));
    expect(sql).toMatch(/is not recorded as applied/);
    expect(sql).toMatch(/newer migration is recorded as applied/);
  });
});

describe("migration history check", () => {
  const files = [{ name: N1, body: "select 1;" }, { name: N2, body: "select 2;" }];
  it("lists what is pending, oldest first", () => {
    expect(checkHistory(files, [{ name: N1, checksum: checksum("select 1;") }]).pending.map((f: { name: string }) => f.name)).toEqual([N2]);
  });
  it("stops the release when an applied migration was edited afterwards", () => {
    const r = checkHistory(files, [{ name: N1, checksum: checksum("select 'old';") }]);
    expect(r.problems[0]).toMatch(/changed after it was applied/);
  });
  it("older rows have no checksum: not compared, not a problem", () => {
    expect(checkHistory(files, [{ name: N1, checksum: null }]).problems).toEqual([]);
  });
  it("warns, without stopping, about history rows with no file and out-of-order pending migrations", () => {
    const r = checkHistory(files, [{ name: "20261130000000_gone.sql", checksum: null }, { name: N2, checksum: null }]);
    expect(r.problems).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/no file/);
    expect(r.warnings.join(" ")).toMatch(/out of order/);
  });
});
