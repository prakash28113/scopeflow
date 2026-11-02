/**
 * Every page's code, loaded on demand. The app shell downloads the signed-in pages in the background
 * once it has loaded (preloadAppPages), so switching pages never waits for a download.
 */
export const pages = {
  dashboard: () => import("./dashboard"),
  projects: () => import("./projects"),
  quotations: () => import("./quotations"),
  approvals: () => import("./approvals"),
  expenses: () => import("./expenses"),
  notifications: () => import("./notifications"),
  plan: () => import("./plan"),
  settings: () => import("./settings"),
  projectNew: () => import("./project-new"),
  projectDetail: () => import("./project-detail"),
  projectEdit: () => import("./project-edit"),
  projectRecord: () => import("./project-record"),
  projectQuote: () => import("./project-quote"),
  analytics: () => import("./analytics"),
  invoices: () => import("./invoices"),
  clients: () => import("./clients"),
  changeOrderNew: () => import("./change-order-new"),
};

let preloaded = false;
/** Downloads all signed-in pages when the browser is idle (once per visit). */
export function preloadAppPages() {
  if (preloaded) return;
  preloaded = true;
  const run = () => {
    for (const load of Object.values(pages)) void load().catch(() => {});
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 2500 });
  else setTimeout(run, 1200);
}
