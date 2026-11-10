/**
 * The moment a session exists, start everything the first signed-in screen needs at the same time,
 * instead of one after another (profile, then the page's code, then the plan). Each result lands in
 * the query cache, so the screens that ask for it find it there or already on its way.
 */
import type { QueryClient } from "@tanstack/react-query";

export type WarmQuery = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };

export function warmAccount(qc: Pick<QueryClient, "prefetchQuery">, queries: WarmQuery[], code: (() => Promise<unknown>)[] = []): Promise<unknown> {
  // All started in this tick; none waits for another. Failures are left to the screens' own queries.
  const started = [...queries.map((q) => qc.prefetchQuery({ ...q, staleTime: 30_000 })), ...code.map((load) => load().catch(() => {}))];
  return Promise.allSettled(started);
}
