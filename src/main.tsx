import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createBrowserRouter, matchRoutes, RouterProvider, type RouteObject } from "react-router";
import { hydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/toast";
import { configured } from "./lib/supabase";
import { routes } from "./routes/tree";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: true } },
});

/**
 * Public pages arrive prerendered (scripts/prerender.mjs): #root already holds the page and
 * data-page says which path it was rendered for. On that path React adopts the existing markup
 * (hydration), so there's no flash and the intro animations don't restart. Everywhere else
 * (the app, and any other path that received a prerendered file) it renders from scratch.
 */
async function prepareHydration(el: HTMLElement): Promise<boolean> {
  const here = location.pathname.replace(/\/+$/, "") || "/";
  if (!el.dataset.page || el.dataset.page !== here || !el.firstElementChild) return false;
  // The page's code must be loaded before the first render, so the router starts on the page, not a spinner.
  const matches = matchRoutes(routes, location) ?? [];
  await Promise.all(
    matches.map(async ({ route }) => {
      if (typeof route.lazy !== "function") return;
      const loaded = await (route.lazy as () => Promise<Partial<RouteObject>>)();
      Object.assign(route, loaded, { lazy: undefined });
    }),
  );
  // Data the page was prerendered with (e.g. the plan catalogue on /pricing), so the first render matches.
  const state = document.getElementById("sf-state");
  if (state?.textContent) {
    try {
      hydrate(queryClient, JSON.parse(state.textContent));
    } catch {
      return false;
    }
  }
  return true;
}

const rootEl = document.getElementById("root")!;
if (!configured) {
  createRoot(rootEl).render(
    <p style={{ padding: 24, fontFamily: "system-ui" }}>
      ScopeFlow isn't configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY and rebuild.
    </p>,
  );
} else {
  const adopt = await prepareHydration(rootEl).catch(() => false);
  const app = (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={createBrowserRouter(routes)} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  if (adopt) {
    hydrateRoot(rootEl, app);
  } else {
    rootEl.replaceChildren();
    delete rootEl.dataset.page;
    createRoot(rootEl).render(app);
  }
}
