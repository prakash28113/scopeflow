import "@fontsource-variable/inter";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/toast";
import { AppShell, PageSpinner, RequireAuth } from "./components/app-shell";
import NotFound, { RouteError } from "./routes/not-found";
import { configured } from "./lib/supabase";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true } },
});

const lazy = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    hydrateFallbackElement: <PageSpinner />,
    children: [
      { path: "/", lazy: lazy(() => import("./routes/landing")) },
      { path: "/login", lazy: lazy(() => import("./routes/auth").then((m) => ({ default: m.LoginPage }))) },
      { path: "/signup", lazy: lazy(() => import("./routes/auth").then((m) => ({ default: m.SignupPage }))) },
      // Client portal: token-gated, no account. Token is read from the URL fragment.
      { path: "/p", lazy: lazy(() => import("./routes/portal")) },
      {
        element: <RequireAuth allowUnonboarded />,
        children: [{ path: "/onboarding", lazy: lazy(() => import("./routes/settings").then((m) => ({ default: m.OnboardingPage }))) }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: "/dashboard", lazy: lazy(() => import("./routes/dashboard")) },
              { path: "/notifications", lazy: lazy(() => import("./routes/notifications")) },
              { path: "/settings", lazy: lazy(() => import("./routes/settings").then((m) => ({ default: m.SettingsPage }))) },
              { path: "/projects/new", lazy: lazy(() => import("./routes/project-new")) },
              { path: "/projects/:id", lazy: lazy(() => import("./routes/project-detail")) },
              { path: "/projects/:id/edit", lazy: lazy(() => import("./routes/project-edit")) },
              { path: "/projects/:id/change-orders/new", lazy: lazy(() => import("./routes/change-order-new")) },
            ],
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const root = createRoot(document.getElementById("root")!);
if (!configured) {
  root.render(
    <p style={{ padding: 24, fontFamily: "system-ui" }}>
      ScopeFlow isn't configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY and rebuild.
    </p>,
  );
} else {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
