/**
 * Runs the real migration against an in-process PostgreSQL (PGlite) with a
 * minimal stand-in for Supabase's `auth` schema and API roles, so RLS,
 * grants, triggers and functions are exercised exactly as written.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const SUPABASE_STUB = readFileSync(fileURLToPath(new URL("./supabase-stub.sql", import.meta.url)), "utf8");

export type Role = { kind: "user"; id: string } | { kind: "anon" } | { kind: "service" };

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
export const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
export const readMigration = (file: string) => readFileSync(join(MIGRATIONS_DIR, file), "utf8");

/** A database with every migration applied, or only those up to and including `upTo`. */
export async function createDb(opts: { upTo?: string } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    await db.exec(readMigration(file));
    if (file === opts.upTo) break;
  }
  return db;
}

export async function as<T = Record<string, unknown>>(
  db: PGlite,
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    if (role.kind === "user") {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [role.id]);
    } else if (role.kind === "anon") {
      await tx.exec("set local role anon");
    } else {
      await tx.exec("set local role service_role");
    }
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

export async function createUser(db: PGlite, email: string, fullName = "Test User") {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify({ full_name: fullName }),
  ]);
  return { kind: "user" as const, id };
}


export const anon: Role = { kind: "anon" };
export const service: Role = { kind: "service" };
