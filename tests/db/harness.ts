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

export const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  -- Same semantics as Supabase: legacy per-claim setting, else the JWT claims JSON.
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Mirror Supabase defaults: API roles get broad grants; RLS is the guard.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Role = { kind: "user"; id: string } | { kind: "anon" } | { kind: "service" };

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
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
