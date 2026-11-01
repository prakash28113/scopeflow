/** UPI payment details: set by the freelancer, shown to clients on rupee projects only. */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { anon, as, createDb, createUser, readMigration, type Role } from "./harness";

type Json = Record<string, unknown>;
const DOWN = readFileSync(new URL("../../supabase/rollback/20261104000000_upi_payments_down.sql", import.meta.url), "utf8");
let db: PGlite;
let owner: Role & { id: string };

const project = (currency: string) => ({
  title: `Logo ${currency}`, currency, budget_cents: 100000,
  client: { name: "Client", email: `c-${currency.toLowerCase()}@example.com` },
  deliverables: [{ title: "Logo", revisions_included: 2 }],
  milestones: [{ title: "Advance", amount_cents: 50000 }],
});
async function rpc<T = Json>(role: Role, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await as<{ r: T }>(db, role, `select public.${fn}(${placeholders}) as r`, args))[0].r;
}
async function link(currency: string) {
  const id = await rpc<string>(owner, "save_project", [null, JSON.stringify(project(currency))]);
  return ((await rpc<Json>(owner, "send_scope", [id, 30])).link as Json).token as string;
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "upi@example.com", "Raman");
  await rpc(owner, "complete_onboarding", ["Raman", "Raman Studio", "INR"]);
});

describe("UPI payment details", () => {
  it("are set, validated and cleared by the freelancer only", async () => {
    await rpc(owner, "set_payment_details", ["raman.studio@okicici"]);
    expect((await as<Json>(db, owner, "select upi_id from profiles"))[0].upi_id).toBe("raman.studio@okicici");
    await expect(rpc(owner, "set_payment_details", ["not a upi id"])).rejects.toThrow(/UPI ID like/);
    await expect(rpc(owner, "set_payment_details", ["x@1bank"])).rejects.toThrow(/UPI ID like/);
    await expect(rpc(anon, "set_payment_details", ["a@b"])).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, "update profiles set upi_id = 'evil@bank'")).rejects.toThrow(/permission denied/);
    await rpc(owner, "set_payment_details", [""]);
    expect((await as<Json>(db, owner, "select upi_id from profiles"))[0].upi_id).toBeNull();
    await rpc(owner, "set_payment_details", ["raman.studio@okicici"]);
  });

  it("appear on the client page for rupee projects, never for other currencies", async () => {
    const inr = await rpc<Json>(anon, "portal_view", [await link("INR")]);
    expect(inr.payment).toEqual({ upi_id: "raman.studio@okicici", payee_name: "Raman Studio" });
    const usd = await rpc<Json>(anon, "portal_view", [await link("USD")]);
    expect(usd.payment).toBeNull();
    expect(JSON.stringify(inr)).not.toMatch(/upi@example\.com/); // still no owner email
  });

  it("migration re-runs and rolls back cleanly", async () => {
    const fresh = await createDb();
    await fresh.exec(readMigration("20261104000000_upi_payments.sql"));
    await fresh.exec(DOWN);
    await fresh.exec(DOWN);
    expect((await fresh.query<Json>("select count(*)::int n from information_schema.columns where table_name = 'profiles' and column_name = 'upi_id'")).rows[0].n).toBe(0);
    await fresh.exec(readMigration("20261104000000_upi_payments.sql"));
    expect((await fresh.query<Json>("select to_regproc('public.set_payment_details') is not null as ok")).rows[0].ok).toBe(true);
  });
});
