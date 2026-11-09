/** Page titles and noindex for pages that aren't prerendered (kept apart from seo.ts so the app doesn't load the public pages' data). */
import { useEffect } from "react";

const SITE_NAME = "ScopeFlow";

/** Sets a plain page title (app and sign-in pages, which aren't prerendered). */
export function useTitle(title: string, { bare = false }: { bare?: boolean } = {}) {
  useEffect(() => {
    document.title = bare || title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
  }, [title, bare]);
}

/** Asks search engines not to index the current page (e.g. "Page not found"), and removes the request on leaving it. */
export function useNoIndex() {
  useEffect(() => {
    const el = document.createElement("meta");
    el.name = "robots";
    el.content = "noindex";
    document.head.appendChild(el);
    return () => el.remove();
  }, []);
}
