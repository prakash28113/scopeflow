/**
 * Permission audit as code. Reads PostgreSQL's catalog after applying the real
 * migration (with Supabase's default broad grants in place) and checks every
 * table, policy and function against an explicit allowlist. Adding a table or
 * function without reviewing its access makes this suite fail.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

const PORTAL_FUNCTIONS = ["portal_view", "portal_decide_scope", "portal_request_revision", "portal_decide_change_order"];
const ANON_FUNCTIONS = [...PORTAL_FUNCTIONS, "health"].sort();
const FREELANCER_FUNCTIONS = [
  "complete_onboarding", "save_project", "delete_draft_project", "rotate_share_link", "revoke_share_link",
  "send_scope", "recall_scope", "resolve_revision", "create_change_order", "withdraw_change_order",
  "complete_change_order_work", "set_milestone_paid", "complete_project", "cancel_project",
  "unread_notification_count", "mark_notifications_seen", "my_plan", "join_early_access", "update_client", "set_payment_details", "set_invoice_details", "update_client_billing", "create_invoice", "void_invoice", "set_deliverable_progress", "add_expense", "delete_expense", "set_signup_source", "record_payment", "delete_payment", "add_follow_up", "set_follow_up_done", "delete_follow_up", "log_client_request", "create_client", "save_template", "delete_template",
  "add_payment", "archive_client", "delete_client", "log_usage_event",
  "is_blog_author", "blog_my_posts", "save_blog_post", "delete_blog_post", "create_blog_key", "blog_my_keys", "revoke_blog_key",
];
// Plan changes: never callable from the app. admin_set_plan = SQL editor; process_billing_event = service role (future webhook).
// Razorpay billing: the "billing" Edge Function calls these as service role, after verifying the
// user's session or the webhook signature.
const BILLING_SERVICE = [
  "billing_prepare_checkout", "billing_save_provider_plan", "billing_record_checkout",
  "billing_current_subscription", "billing_mark_cancelling", "process_razorpay_event",
  // The "blog" Edge Function, after hashing the publishing key it received.
  "blog_publish_with_key",
];
const BACK_OFFICE = ["admin_set_plan", "admin_signup_sources", "admin_usage_counts", "process_billing_event", ...BILLING_SERVICE];
const AUTHENTICATED_FUNCTIONS = [...FREELANCER_FUNCTIONS, ...ANON_FUNCTIONS].sort();
const SECURITY_DEFINER = [...FREELANCER_FUNCTIONS, ...PORTAL_FUNCTIONS, ...BACK_OFFICE, "health", "_handle_new_user", "_create_subscription", "_number_quote"].sort();

const OWNER_READABLE = [
  "profiles", "clients", "projects", "deliverables", "scope_snapshots", "scope_decisions", "revision_requests",
  "change_orders", "change_order_decisions", "milestones", "activity_log",
  "subscription_changes", "invoices", "early_access_requests", "client_invoices", "expenses", "payments", "follow_ups", "scope_templates", "usage_events",
].sort();
// share_links, subscriptions: column grants only (never the token hash / provider ids).
const NOT_READABLE = ["blog_authors", "blog_api_keys", "beta_allowlist", "portal_rate_limits", "share_links", "subscriptions", "billing_events", "provider_plans", "billing_checkouts"].sort();
const PUBLIC_CATALOGUE = ["plans", "blog_posts"]; // pricing page; published blog posts (RLS hides drafts). No personal data
const ALL_TABLES = [...OWNER_READABLE, ...NOT_READABLE, ...PUBLIC_CATALOGUE].sort();
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

describe("tables and RLS", () => {
  it("has exactly the reviewed set of tables, all with Row Level Security enabled", async () => {
    const rows = await q<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p') order by relname",
    );
    expect(rows.map((r) => r.relname)).toEqual(ALL_TABLES);
    for (const r of rows) expect(r.relrowsecurity, `${r.relname} RLS`).toBe(true);
  });

  it("has no views, materialized views or sequences in public (views can bypass RLS)", async () => {
    const rows = await q<{ relname: string }>(
      "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('v','m','S')",
    );
    expect(rows).toEqual([]);
  });

  it("anon can read only the public plan catalogue, and write nothing", async () => {
    for (const t of ALL_TABLES) for (const p of PRIVS) {
      const [r] = await q<{ ok: boolean }>("select has_table_privilege('anon', $1, $2) as ok", [`public.${t}`, p]);
      expect(r.ok, `anon ${p} ${t}`).toBe(p === "SELECT" && PUBLIC_CATALOGUE.includes(t));
    }
  });

  it("authenticated can only SELECT owner-scoped tables, and never write directly", async () => {
    for (const t of ALL_TABLES) for (const p of PRIVS) {
      const [r] = await q<{ ok: boolean }>("select has_table_privilege('authenticated', $1, $2) as ok", [`public.${t}`, p]);
      const expected = p === "SELECT" && (OWNER_READABLE.includes(t) || PUBLIC_CATALOGUE.includes(t));
      expect(r.ok, `authenticated ${p} ${t}`).toBe(expected);
    }
  });

  it("owners may read share-link status columns but never the token hash", async () => {
    const cols = await q<{ column_name: string; ok: boolean }>(
      "select column_name, has_column_privilege('authenticated', 'public.share_links', column_name, 'SELECT') as ok from information_schema.columns where table_schema = 'public' and table_name = 'share_links' order by column_name",
    );
    const readable = cols.filter((c) => c.ok).map((c) => c.column_name).sort();
    expect(readable).toEqual(["created_at", "expires_at", "id", "project_id", "revoked_at"]);
  });

  it("owners may read their plan and status but never provider identifiers", async () => {
    const cols = await q<{ column_name: string; ok: boolean }>(
      "select column_name, has_column_privilege('authenticated', 'public.subscriptions', column_name, 'SELECT') as ok from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' order by column_name",
    );
    const hidden = cols.filter((c) => !c.ok).map((c) => c.column_name).sort();
    expect(hidden).toEqual(["provider", "provider_customer_id", "provider_subscription_id"]);
  });

  it("every policy is SELECT-only, for authenticated, and scoped to the owner", async () => {
    const policies = await q<{ tablename: string; cmd: string; roles: string; qual: string; permissive: string }>(
      "select tablename, cmd, roles::text, qual, permissive from pg_policies where schemaname = 'public' order by tablename",
    );
    expect(policies.map((p) => p.tablename).sort()).toEqual([...OWNER_READABLE, "share_links", "subscriptions", ...PUBLIC_CATALOGUE].sort());
    for (const p of policies.filter((x) => !PUBLIC_CATALOGUE.includes(x.tablename))) {
      expect(p.cmd, p.tablename).toBe("SELECT");
      expect(p.roles, p.tablename).toBe("{authenticated}");
      expect(p.permissive, p.tablename).toBe("PERMISSIVE");
      expect(p.qual, p.tablename).toMatch(/auth\.uid\(\)/);
    }
  });

  it("immutable records are protected by triggers", async () => {
    const rows = await q<{ tbl: string }>(
      "select c.relname as tbl from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid where p.proname = '_forbid_mutation' order by 1",
    );
    expect(rows.map((r) => r.tbl)).toEqual(["activity_log", "change_order_decisions", "scope_decisions", "scope_snapshots"]);
    const audit = await q<{ tbl: string }>(
      "select c.relname as tbl from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid where p.proname = '_forbid_change' order by 1",
    );
    expect(audit.map((r) => r.tbl)).toEqual(["subscription_changes"]);
  });

  it("the plan catalogue policy is read-only", async () => {
    const [p] = await q<{ cmd: string; roles: string }>("select cmd, roles::text from pg_policies where tablename = 'plans'");
    expect(p).toEqual({ cmd: "SELECT", roles: "{anon,authenticated}" });
  });
});

describe("functions", () => {
  type Fn = { name: string; secdef: boolean; config: string[] | null; src: string; oid: number };
  let fns: Fn[];
  beforeAll(async () => {
    fns = await q<Fn>(
      "select proname as name, prosecdef as secdef, proconfig as config, prosrc as src, oid::int as oid from pg_proc where pronamespace = 'public'::regnamespace order by proname",
    );
  });

  it("only the reviewed functions run as SECURITY DEFINER", () => {
    expect(fns.filter((f) => f.secdef).map((f) => f.name).sort()).toEqual(SECURITY_DEFINER);
  });

  it("every function pins search_path to empty (no search-path hijacking)", () => {
    for (const f of fns) expect(f.config, f.name).toContain('search_path=""');
  });

  it("anon can execute exactly the public portal functions and health()", async () => {
    const rows = await q<{ name: string }>(
      "select proname as name from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'EXECUTE') order by 1",
    );
    expect(rows.map((r) => r.name).sort()).toEqual(ANON_FUNCTIONS);
  });

  it("authenticated can execute exactly the freelancer API plus the public functions", async () => {
    const rows = await q<{ name: string }>(
      "select proname as name from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', oid, 'EXECUTE') order by 1",
    );
    expect(rows.map((r) => r.name).sort()).toEqual(AUTHENTICATED_FUNCTIONS);
  });

  it("plan changes are not callable from the app; the billing webhook entry point is service-role only", async () => {
    for (const name of BACK_OFFICE) {
      const [r] = await q<{ anon: boolean; auth: boolean; svc: boolean }>(
        "select bool_or(has_function_privilege('anon', oid, 'EXECUTE')) as anon, bool_or(has_function_privilege('authenticated', oid, 'EXECUTE')) as auth, bool_or(has_function_privilege('service_role', oid, 'EXECUTE')) as svc from pg_proc where proname = $1",
        [name],
      );
      expect([r.anon, r.auth], name).toEqual([false, false]);
      expect(r.svc, name).toBe(!name.startsWith("admin_"));
    }
  });

  it("no function is executable via the PUBLIC pseudo-role", async () => {
    const rows = await q<{ name: string }>(
      "select p.proname as name from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE'",
    );
    expect(rows).toEqual([]);
  });

  it("each freelancer function checks the caller's identity", () => {
    for (const name of FREELANCER_FUNCTIONS) {
      const f = fns.find((x) => x.name === name)!;
      expect(f.src, name).toMatch(/_owned_project\(|_uid\(\)|auth\.uid\(\)|_require_blog_author\(/); // _require_blog_author calls _uid()
    }
  });

  it("each public portal function goes through the link + rate-limit gate", () => {
    for (const name of PORTAL_FUNCTIONS) {
      const f = fns.find((x) => x.name === name)!;
      expect(f.src, name).toContain("public._portal_gate(p_token");
    }
  });

  it("public portal responses never include owner identifiers", () => {
    for (const name of PORTAL_FUNCTIONS) {
      const f = fns.find((x) => x.name === name)!;
      // Internal use (e.g. looking up the studio's display name) is fine; returning it is not.
      expect(f.src, name).not.toMatch(/'owner_id'|'project_id'|'email'/);
    }
  });
});
