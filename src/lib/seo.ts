/** Keeps <head> right in the browser. Page data and structured data live in seo-pages.ts. */
import { useEffect } from "react";
import { canonicalUrl, OG_IMAGE, PUBLIC_PAGES, type PublicPath } from "./seo-pages";

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
export function usePageHead(head: { title: string; description: string; url: string; image?: string; type?: "website" | "article" } | null) {
  const { title, description, url } = head ?? { title: "", description: "", url: "" };
  const image = head?.image ?? OG_IMAGE;
  const type = head?.type ?? "website";
  useEffect(() => {
    if (!title) return;
    document.title = title;
    setMeta("name", "description", description);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", url);
    setMeta("property", "og:type", type);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:image", image);
    // Uploaded covers have their own dimensions and alt text.
    if (image !== OG_IMAGE) {
      for (const key of ["width", "height", "alt"]) document.head.querySelector(`meta[property="og:image:${key}"]`)?.remove();
    }
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = url;
  }, [title, description, url, image, type]);
}

/** Keeps <head> right for a public page after in-app navigation (the prerendered HTML already has it on first load). */
export function useSeo(path: PublicPath) {
  const page = PUBLIC_PAGES[path];
  usePageHead({ title: page.title, description: page.description, url: canonicalUrl(path) });
}
