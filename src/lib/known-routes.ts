/**
 * Every page address the app answers (src/routes/tree.tsx). The Worker uses it to send a real 404
 * status for anything else, instead of the app shell with 200 (a "soft 404" to search engines).
 * Pure: the Worker imports it too. tests/unit/seo-redirects.test.ts keeps it in step with the routes.
 */
const ID = "[^/]+";
const PATTERNS: RegExp[] = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/p",
  "/pricing",
  "/privacy",
  "/terms",
  "/refunds",
  "/contact",
  "/blog",
  "/blog/write",
  `/blog/${ID}`,
  "/dashboard",
  "/projects",
  "/projects/new",
  `/projects/${ID}`,
  `/projects/${ID}/edit`,
  `/projects/${ID}/record`,
  `/projects/${ID}/quote`,
  `/projects/${ID}/change-orders/new`,
  "/quotations",
  "/approvals",
  "/expenses",
  "/notifications",
  "/plan",
  "/settings",
  "/analytics",
  "/invoices",
  `/invoices/${ID}`,
  "/clients",
  `/clients/${ID}`,
].map((p) => new RegExp(`^${p}$`));

export function isKnownPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PATTERNS.some((re) => re.test(path));
}
