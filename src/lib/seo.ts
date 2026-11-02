/** Keeps <head> right in the browser. Page data and structured data live in seo-pages.ts. */
import { useEffect } from "react";
import { canonicalUrl, PUBLIC_PAGES, type PublicPath } from "./seo-pages";

export * from "./seo-pages";

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Sets the page's title, description, canonical address and link-preview tags (any public page). */
export function usePageHead(head: { title: string; description: string; url: string } | null) {
  const { title, description, url } = head ?? { title: "", description: "", url: "" };
  useEffect(() => {
    if (!title) return;
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", url);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = url;
  }, [title, description, url]);
}

/** Keeps <head> right for a public page after in-app navigation (the prerendered HTML already has it on first load). */
export function useSeo(path: PublicPath) {
  const page = PUBLIC_PAGES[path];
  usePageHead({ title: page.title, description: page.description, url: canonicalUrl(path) });
}
