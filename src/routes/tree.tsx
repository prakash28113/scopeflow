import type { RouteObject } from "react-router";
import { PageSpinner, RequireAuth, AppShell } from "../components/app-shell";
import NotFound, { RouteError } from "./not-found";
import { pages } from "./loaders";

/** Every route in the app. Shared by the browser entry (main.tsx) and the build-time prerenderer (prerender.tsx). */
const lazy = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    hydrateFallbackElement: <PageSpinner />,
    children: [
      { path: "/", lazy: lazy(() => import("./landing")) },
      { path: "/login", lazy: lazy(() => import("./auth").then((m) => ({ default: m.LoginPage }))) },
      { path: "/signup", lazy: lazy(() => import("./auth").then((m) => ({ default: m.SignupPage }))) },
      { path: "/forgot-password", lazy: lazy(() => import("./auth").then((m) => ({ default: m.ForgotPasswordPage }))) },
      { path: "/reset-password", lazy: lazy(() => import("./auth").then((m) => ({ default: m.ResetPasswordPage }))) },
      // Client portal: token-gated, no account. Token is read from the URL fragment.
      { path: "/p", lazy: lazy(() => import("./portal")) },
      { path: "/pricing", lazy: lazy(() => import("./pricing")) },
      { path: "/privacy", lazy: lazy(() => import("./legal").then((m) => ({ default: m.PrivacyPage }))) },
      { path: "/terms", lazy: lazy(() => import("./legal").then((m) => ({ default: m.TermsPage }))) },
      {
        element: <RequireAuth allowUnonboarded />,
        children: [{ path: "/onboarding", lazy: lazy(() => import("./settings").then((m) => ({ default: m.OnboardingPage }))) }],
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
];
