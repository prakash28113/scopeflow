/**
 * Build-time renderer for the public pages (run by scripts/prerender.mjs, never shipped to browsers).
 * Renders exactly the tree main.tsx hydrates, so React can adopt the static markup in the browser.
 */
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/toast";
import { routes } from "./routes/tree";
import { plansQuery } from "./lib/plans";
import { PUBLIC_PAGES, SITE_URL, structuredData, canonicalUrl, OG_IMAGE, type PublicPath } from "./lib/seo";

export { PUBLIC_PAGES, SITE_URL, structuredData, canonicalUrl, OG_IMAGE };
export type { PublicPath };

/** Data a page needs on first render, fetched once per build. Optional: a page renders its loading state without it. */
async function prefetch(qc: QueryClient, path: PublicPath) {
  if (path !== "/pricing") return;
  const timeout = new Promise((resolve) => setTimeout(resolve, 8_000));
  await Promise.race([qc.prefetchQuery({ ...plansQuery, retry: 0 }), timeout]);
}

export async function render(path: PublicPath): Promise<{ html: string; state: unknown | null }> {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(SITE_URL + path));
  if (context instanceof Response) throw new Error(`Prerender of ${path} returned a redirect or response (${context.status})`);
  if (context.statusCode !== 200) throw new Error(`Prerender of ${path} returned ${context.statusCode}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  await prefetch(qc, path);
  const hasData = qc.getQueryCache().getAll().some((q) => q.state.status === "success");
  const html = renderToString(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ToastProvider>
            <StaticRouterProvider router={router} context={context} hydrate={false} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  const state = hasData ? dehydrate(qc, { shouldDehydrateQuery: (q) => q.state.status === "success" }) : null;
  qc.clear();
  return { html, state };
}
