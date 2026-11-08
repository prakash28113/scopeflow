/**
 * Talking to the AI endpoints from the app. Every answer is validated again here with the shared
 * schemas before anything is shown, and AI features stay hidden unless the Worker says they're on
 * for this account.
 */
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { supabase } from "./supabase";
import type { AiResult } from "./ai-schemas";

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Whether AI is on for this account, and how many suggestions are left today. */
export function useAiStatus() {
  return useQuery({
    queryKey: ["ai-status"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ enabled: boolean; remaining: number | null }> => {
      const t = await token();
      if (!t) return { enabled: false, remaining: null };
      const res = await fetch("/api/ai/status", { headers: { authorization: `Bearer ${t}` } }).catch(() => null);
      if (!res?.ok) return { enabled: false, remaining: null };
      const body = (await res.json().catch(() => null)) as { enabled?: boolean; remaining?: number | null } | null;
      return { enabled: body?.enabled === true, remaining: typeof body?.remaining === "number" ? body.remaining : null };
    },
  });
}

export async function askAi<S extends z.ZodType>(path: "scope-draft" | "change-impact" | "assistant", body: unknown, schema: S): Promise<AiResult<z.infer<S>>> {
  const t = await token();
  if (!t) return { ok: false, code: "auth", error: "Sign in again to use this." };
  let res: Response;
  try {
    res = await fetch(`/api/ai/${path}`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, code: "failed", error: "You seem to be offline. Check your connection and try again." };
  }
  const data = (await res.json().catch(() => null)) as AiResult<unknown> | null;
  if (!data) return { ok: false, code: "failed", error: "AI couldn't answer this time. Try again." };
  if (!data.ok) return data;
  const parsed = schema.safeParse(data.result);
  if (!parsed.success) return { ok: false, code: "invalid", error: "AI gave an answer ScopeFlow couldn't use. Try again." };
  return { ok: true, result: parsed.data, provider: data.provider, remaining: data.remaining };
}
