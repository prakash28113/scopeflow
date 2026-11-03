/**
 * QA retest 3, FX-008: quote numbers per Indian financial year, given at first send and kept for
 * every later version; quotes sent before the change get numbers in the order they were sent.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
async function rpcOn<T = Json>(d: PGlite, role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(d, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
async function draft(d: PGlite, u: Role, title: string) {
  return rpcOn<string>(d, u, "save_project", [null, JSON.stringify({
    title, currency: "INR", budget_cents: 1000000,
    client: { name: "Asha", email: `asha-${title.length}@acme.in`, company: "Acme" },
    deliverables: [{ title: "Logo", revisions_included: 2 }],
  })]);
}
const numberOf = async (d: PGlite, u: Role, id: string) => (await as<{ quote_number: string | null }>(d, u, "select quote_number from projects where id = $1", [id]))[0].quote_number;
const fy = (() => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
})();

describe("quote numbers", () => {
  it("are given at first send, in order, and stay the same for later versions", async () => {
    const d = await createDb();
    const u = await createUser(d, "quotes@example.com", "Quote Maker");
    const a = await draft(d, u, "Brand kit");
    const b = await draft(d, u, "Website refresh");
    expect(await numberOf(d, u, a)).toBeNull(); // drafts have none yet
    await rpcOn(d, u, "send_scope", [b, 30]);
    const token = ((await rpcOn<Json>(d, u, "send_scope", [a, 30])).link as Json).token as string;
    expect(await numberOf(d, u, b)).toBe(`QT-${fy}-001`);
    expect(await numberOf(d, u, a)).toBe(`QT-${fy}-002`);
    // A new version (after changes are requested) keeps the number.
    const view = await rpcOn<Json>(d, anon, "portal_view", [token]);
    await rpcOn(d, anon, "portal_decide_scope", [token, (view.snapshot as Json).id, "rejected", "Asha", "Bigger logo"]);
    await rpcOn(d, u, "save_project", [a, JSON.stringify({
      title: "Brand kit v2", currency: "INR", budget_cents: 1200000,
      client: { name: "Asha", email: "asha-9@acme.in", company: "Acme" },
      deliverables: [{ title: "Logo", revisions_included: 3 }],
    })]);
    await rpcOn(d, u, "send_scope", [a, 30]);
    expect(await numberOf(d, u, a)).toBe(`QT-${fy}-002`);
    // Numbers are per account.
    const other = await createUser(d, "other@example.com", "Other");
    const c = await draft(d, other, "Menu card");
    await rpcOn(d, other, "send_scope", [c, 30]);
    expect(await numberOf(d, other, c)).toBe(`QT-${fy}-001`);
    // Not writable from the app.
    await expect(as(d, u, "update projects set quote_number = 'X' where id = $1", [a])).rejects.toThrow(/permission denied/);
  });

  it("numbers quotes sent before the change in the order they were sent, by financial year", async () => {
    const d = await createDb({ upTo: "20261117000000_fix_owner_surname.sql" });
    const u = await createUser(d, "legacy-q@example.com", "Legacy");
    const a = await draft(d, u, "Old one");
    const b = await draft(d, u, "Newer one");
    const c = await draft(d, u, "Newest");
    await rpcOn(d, u, "send_scope", [a, 30]);
    await rpcOn(d, u, "send_scope", [b, 30]);
    await rpcOn(d, u, "send_scope", [c, 30]);
    await d.exec("set session_replication_role = replica"); // snapshots are immutable; backdate them for the test
    await d.query("update scope_snapshots set created_at = '2026-02-10T10:00:00Z' where project_id = $1", [a]);
    await d.query("update scope_snapshots set created_at = '2026-05-01T10:00:00Z' where project_id = $1", [b]);
    await d.query("update scope_snapshots set created_at = '2026-06-01T10:00:00Z' where project_id = $1", [c]);
    await d.exec("set session_replication_role = origin");
    await d.exec(readMigration("20261118000000_quote_numbers.sql"));
    expect(await numberOf(d, u, a)).toBe("QT-2025-26-001");
    expect(await numberOf(d, u, b)).toBe("QT-2026-27-001");
    expect(await numberOf(d, u, c)).toBe("QT-2026-27-002");
  });

  it("rolls back (twice) and re-applies", async () => {
    const d = await createDb();
    const { readFileSync } = await import("node:fs");
    const down = readFileSync(new URL("../../supabase/rollback/20261118000000_quote_numbers_down.sql", import.meta.url), "utf8");
    await d.exec(down);
    await d.exec(down);
    expect((await d.query("select 1 from information_schema.columns where table_name = 'projects' and column_name = 'quote_number'")).rows).toEqual([]);
    await d.exec(readMigration("20261118000000_quote_numbers.sql"));
  });
});
