/**
 * Prefetching: start loading a page's data the moment someone shows intent to open it
 * (pointer over a link, keyboard focus, or a finger touching it), so the page opens with its data.
 * Requests are the same ones the page makes, so React Query reuses them; fresh data isn't fetched twice.
 */
import type { QueryClient } from "@tanstack/react-query";
import { projectQuery } from "./queries";
import { pages } from "@/routes/loaders";

const FRESH = 60_000;

export function prefetchPath(qc: QueryClient, path: string) {
  const project = /^\/projects\/([0-9a-f-]{36})$/.exec(path);
  if (project) {
    void pages.projectDetail();
    void qc.prefetchQuery({ ...projectQuery(project[1]), staleTime: FRESH });
    return;
  }
  if (path.startsWith("/clients")) {
    void pages.clients().then((m) => qc.prefetchQuery({ ...m.clientsQuery, staleTime: FRESH }));
  } else if (path.startsWith("/invoices")) {
    void pages.invoices().then((m) => qc.prefetchQuery({ ...m.invoicesQuery, staleTime: FRESH }));
  } else if (path.startsWith("/analytics") || path.startsWith("/expenses")) {
    void pages.analytics().then((m) => qc.prefetchQuery({ ...m.analyticsQuery, staleTime: FRESH }));
  }
}

/** Props for a link: prefetch on hover, focus or touch. */
export function intentProps(qc: QueryClient, path: string) {
  const go = () => prefetchPath(qc, path);
  return { onPointerEnter: go, onFocus: go, onTouchStart: go };
}
