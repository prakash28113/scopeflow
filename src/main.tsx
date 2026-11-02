import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
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
import { pages } from "./routes/loaders";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: true } },
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
      { path: "/forgot-password", lazy: lazy(() => import("./routes/auth").then((m) => ({ default: m.ForgotPasswordPage }))) },
      { path: "/reset-password", lazy: lazy(() => import("./routes/auth").then((m) => ({ default: m.ResetPasswordPage }))) },
      // Client portal: token-gated, no account. Token is read from the URL fragment.
      { path: "/p", lazy: lazy(() => import("./routes/portal")) },
      { path: "/pricing", lazy: lazy(() => import("./routes/pricing")) },
      { path: "/privacy", lazy: lazy(() => import("./routes/legal").then((m) => ({ default: m.PrivacyPage }))) },
      { path: "/terms", lazy: lazy(() => import("./routes/legal").then((m) => ({ default: m.TermsPage }))) },
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
              { path: "/dashboard", lazy: lazy(pages.dashboard) },
              { path: "/projects", lazy: lazy(pages.projects) },
              { path: "/quotations", lazy: lazy(pages.quotations) },
              { path: "/approvals", lazy: lazy(pages.approvals) },
              { path: "/expenses", lazy: lazy(pages.expenses) },
              { path: "/notifications", lazy: lazy(pages.notifications) },
              { path: "/plan", lazy: lazy(pages.plan) },
              { path: "/settings", lazy: lazy(() => pages.settings().then((m) => ({ default: m.SettingsPage }))) },
              { path: "/projects/new", lazy: lazy(pages.projectNew) },
              { path: "/projects/:id", lazy: lazy(pages.projectDetail) },
              { path: "/projects/:id/edit", lazy: lazy(pages.projectEdit) },
              { path: "/projects/:id/record", lazy: lazy(pages.projectRecord) },
              { path: "/projects/:id/quote", lazy: lazy(pages.projectQuote) },
              { path: "/analytics", lazy: lazy(pages.analytics) },
              { path: "/invoices", lazy: lazy(() => pages.invoices().then((m) => ({ default: m.InvoicesPage }))) },
              { path: "/invoices/:id", lazy: lazy(() => pages.invoices().then((m) => ({ default: m.InvoicePage }))) },
              { path: "/clients", lazy: lazy(() => pages.clients().then((m) => ({ default: m.ClientsPage }))) },
              { path: "/clients/:id", lazy: lazy(() => pages.clients().then((m) => ({ default: m.ClientPage }))) },
              { path: "/projects/:id/change-orders/new", lazy: lazy(pages.changeOrderNew) },
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
