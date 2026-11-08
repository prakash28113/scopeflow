/**
 * /api/ai/* — the AI endpoints. Each request is checked in this order:
 *   1. AI is switched on (AI_ACCESS: "all", or a comma list of the accounts allowed to try it);
 *   2. same-origin POST with a small JSON body;
 *   3. a signed-in Supabase session (the user's own access token);
 *   4. the user's daily AI allowance (database function ai_begin, which also checks the project
 *      belongs to them and starts the audit record);
 *   5. input validated with the shared schemas, context read with the user's token (RLS);
 *   6. the model answer validated and guarded, then the audit record is closed (ai_finish).
 * The endpoints never write project data: they return suggestions only.
 */
import { assistantInput, changeImpactInput, scopeDraftInput, type AiResult, type AiTask } from "../../src/lib/ai-schemas";
import { ContextError, projectContext, supa, workspaceContext, type Fetcher } from "./context";
import { chain, cloudflareProvider, geminiProvider, mockProvider, ProviderError, type Provider, type WorkersAi } from "./providers";
import { runAssistant, runChangeImpact, runScopeDraft } from "./tasks";

export interface AiEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** "all", a comma list of emails or user ids, or empty/"off". */
  AI_ACCESS?: string;
  AI?: WorkersAi;
  AI_MODEL?: string;
  /** "mock" for tests and local end-to-end runs (only honoured with a local database). */
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

const MAX_BODY = 24_000;
const ROUTES: Record<string, AiTask> = { "scope-draft": "scope_draft", "change-impact": "change_impact", assistant: "assistant" };

const reply = <T>(body: AiResult<T> | Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" },
  });
const fail = (status: number, code: Extract<AiResult<never>, { ok: false }>["code"], error: string) => reply({ ok: false, code, error }, status);

const isLocal = (url: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url);

export function providerFor(env: AiEnv, f: Fetcher = fetch): Provider | null {
  if (env.AI_PROVIDER === "mock") return isLocal(env.SUPABASE_URL) ? mockProvider() : null;
  const list: Provider[] = [];
  if (env.AI) list.push(cloudflareProvider(env.AI, env.AI_MODEL || undefined));
  if (env.GEMINI_API_KEY) list.push(geminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL || undefined, f));
  return list.length ? chain(list) : null;
}

/** Whether this account may use AI. */
export function allowed(access: string | undefined, user: { id: string; email: string | null }): boolean {
  const a = (access ?? "").trim().toLowerCase();
  if (!a || a === "off") return false;
  if (a === "all") return true;
  const list = a.split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(user.id.toLowerCase()) || (user.email !== null && list.includes(user.email.toLowerCase()));
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers may omit it; the bearer token is still required
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function serveAi(request: Request, env: AiEnv, f: Fetcher = fetch): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/ai/")) return null;
  const route = url.pathname.slice("/api/ai/".length);

  if ((env.AI_ACCESS ?? "").trim() === "" || env.AI_ACCESS === "off") return fail(404, "off", "AI isn't switched on.");
  const provider = providerFor(env, f);
  if (!provider) return fail(404, "off", "AI isn't set up yet.");
  if (!sameOrigin(request)) return fail(403, "forbidden", "Not allowed from another site.");

  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return fail(401, "auth", "Sign in again to use this.");
  const db = supa(env, token, f);
  const user = await db.user().catch(() => null);
  if (!user) return fail(401, "auth", "Sign in again to use this.");
  if (!allowed(env.AI_ACCESS, user)) return fail(404, "off", "AI isn't available on your account yet.");

  if (route === "status") {
    if (request.method !== "GET") return fail(405, "invalid", "Use GET.");
    const left = await db.rpc<number>("ai_remaining", {}).catch(() => null);
    return reply({ ok: true, enabled: true, remaining: typeof left === "number" ? left : null }, 200);
  }

  const task = ROUTES[route];
  if (!task) return fail(404, "invalid", "Unknown AI action.");
  if (request.method !== "POST") return fail(405, "invalid", "Use POST.");
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return fail(415, "invalid", "Send JSON.");
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "invalid", "That's too long. Shorten it and try again.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "invalid", "Send JSON.");
  }

  const parsed = task === "scope_draft" ? scopeDraftInput.safeParse(body) : task === "change_impact" ? changeImpactInput.safeParse(body) : assistantInput.safeParse(body);
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Check what you entered.");
  const projectId = (parsed.data as { projectId?: string | null }).projectId ?? null;

  // Daily allowance + ownership check + audit record, in one database call.
  let started: { id: string; remaining: number };
  try {
    started = await db.rpc<{ id: string; remaining: number }>("ai_begin", { p_task: task, p_project_id: projectId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/limit|today's \d+ AI/i.test(msg)) return fail(429, "limit", msg);
    if (/not found|not yours/i.test(msg)) return fail(404, "forbidden", "That project wasn't found.");
    if (e instanceof ContextError && e.status === 401) return fail(401, "auth", "Sign in again to use this.");
    console.error(`ai_begin: ${msg}`);
    return fail(503, "failed", "AI is unavailable right now. Try again in a minute.");
  }

  const finish = (ok: boolean, used: string | null) => db.rpc("ai_finish", { p_id: started.id, p_provider: used, p_ok: ok }).catch((e) => console.error(`ai_finish: ${String(e)}`));

  try {
    let out: { result: unknown; provider: string };
    if (task === "scope_draft") {
      out = await runScopeDraft(provider, scopeDraftInput.parse(body));
    } else if (task === "change_impact") {
      const input = changeImpactInput.parse(body);
      const ctx = await projectContext(db, input.projectId);
      if (!ctx) {
        await finish(false, null);
        return fail(404, "forbidden", "That project wasn't found.");
      }
      out = await runChangeImpact(provider, ctx, input);
    } else {
      const input = assistantInput.parse(body);
      const ctx = input.projectId ? await projectContext(db, input.projectId) : null;
      if (input.projectId && !ctx) {
        await finish(false, null);
        return fail(404, "forbidden", "That project wasn't found.");
      }
      out = await runAssistant(provider, input, ctx ? { kind: "project", data: ctx } : { kind: "workspace", data: await workspaceContext(db) });
    }
    await finish(true, out.provider);
    return reply({ ok: true, result: out.result, provider: out.provider.split(":")[0], remaining: started.remaining }, 200);
  } catch (e) {
    await finish(false, e instanceof ProviderError ? e.provider : null);
    console.error(`ai ${task}: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof ContextError && e.status === 401) return fail(401, "auth", "Sign in again to use this.");
    const busy = e instanceof ProviderError && /daily|quota|allocation|capacity|429|timed out/i.test(e.message);
    return busy
      ? fail(503, "busy", "AI has reached today's free limit or is busy. Try again later, or fill the form yourself.")
      : fail(502, "failed", "AI couldn't give a usable answer this time. Try again, or fill the form yourself.");
  }
}
