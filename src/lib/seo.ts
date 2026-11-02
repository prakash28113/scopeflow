/**
 * Search-engine and link-preview metadata for the public pages.
 *
 * The build prerenders each page in PUBLIC_PAGES to static HTML (scripts/prerender.mjs) with this
 * title, description, canonical address and structured data in <head>, so crawlers that don't run
 * JavaScript see the real page. In the browser, useSeo keeps <head> right after in-app navigation.
 * Every claim here must be true of the product today: no ratings, reviews, user counts or AI.
 */
import { useEffect } from "react";
import { HOME_FAQ, PRICING_FAQ } from "@/lib/faq";
import { OPERATOR_NAME } from "@/lib/site";

export const SITE_URL = "https://scopeflow.in";
export const SITE_NAME = "ScopeFlow";
export const OG_IMAGE = `${SITE_URL}/og.png?v=3`;

export type PublicPath = "/" | "/pricing" | "/privacy" | "/terms" | "/refunds" | "/contact";
export type PageSeo = {
  /** Shown as the search result's headline. Brand first on the home page, so a search for "ScopeFlow" matches it. */
  title: string;
  /** The search result's snippet: what the page offers, in under ~155 characters. */
  description: string;
  /** Static file the page is written to; "/" is served from home.html via _redirects. */
  file: string;
  changefreq: "weekly" | "monthly" | "yearly";
  priority: string;
};

export const PUBLIC_PAGES: Record<PublicPath, PageSeo> = {
  "/": {
    title: "ScopeFlow: scope, client approvals and GST invoices for freelancers",
    description:
      "ScopeFlow keeps every client job on record: quotes, client approval by link, revisions, change orders, GST invoices with UPI and payments. Free to start.",
    file: "home.html",
    changefreq: "weekly",
    priority: "1.0",
  },
  "/pricing": {
    title: "Pricing: free for 2 active projects | ScopeFlow",
    description:
      "ScopeFlow is free for 2 active projects and 5 clients, with scope approvals, change orders, quotes, GST invoices and payment tracking. No card needed.",
    file: "pricing.html",
    changefreq: "monthly",
    priority: "0.8",
  },
  "/privacy": {
    title: "Privacy Policy | ScopeFlow",
    description: "What ScopeFlow stores, why, who can see it, how long it's kept and the choices you have.",
    file: "privacy.html",
    changefreq: "yearly",
    priority: "0.3",
  },
  "/terms": {
    title: "Terms & Conditions | ScopeFlow",
    description: "The terms for using ScopeFlow, the scope, approval and invoicing workspace for freelancers.",
    file: "terms.html",
    changefreq: "yearly",
    priority: "0.3",
  },
  "/refunds": {
    title: "Refund and cancellation policy | ScopeFlow",
    description: "How to cancel a ScopeFlow paid plan, when payments are refunded, and how long refunds take.",
    file: "refunds.html",
    changefreq: "yearly",
    priority: "0.3",
  },
  "/contact": {
    title: "Contact us | ScopeFlow",
    description: "How to reach ScopeFlow for support, billing, refunds, privacy requests and complaints.",
    file: "contact.html",
    changefreq: "yearly",
    priority: "0.3",
  },
};

export const canonicalUrl = (path: string) => SITE_URL + (path === "/" ? "/" : path);

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

const faq = (items: [string, string][]) => ({
  "@type": "FAQPage",
  mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
});

/** schema.org structured data for a public page (one @graph per page). */
export function structuredData(path: PublicPath): Record<string, unknown> {
  const page = PUBLIC_PAGES[path];
  const url = canonicalUrl(path);
  const organization = {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png`, width: 512, height: 512 },
    founder: { "@type": "Person", name: OPERATOR_NAME },
  };
  const website = {
    "@type": "WebSite",
    "@id": SITE_ID,
    name: SITE_NAME,
    alternateName: "scopeflow.in",
    url: `${SITE_URL}/`,
    inLanguage: "en-IN",
    publisher: { "@id": ORG_ID },
  };
  const webpage = {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: page.title,
    description: page.description,
    isPartOf: { "@id": SITE_ID },
    inLanguage: "en-IN",
  };
  const graph: Record<string, unknown>[] = [organization, website, webpage];
  if (path === "/") {
    graph.push(
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web browser",
        description: page.description,
        image: OG_IMAGE,
        publisher: { "@id": ORG_ID },
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free plan: 2 active projects and 5 clients" },
        featureList: [
          "Scope of work with deliverables, revision limits and dates",
          "Client approval through a private link, no client account needed",
          "Revision tracking against the approved scope",
          "Change orders with price and extra days",
          "Quotes with an expiry date",
          "GST tax invoices with a UPI QR code",
          "Payment, expense and profit tracking",
        ],
      },
      faq(HOME_FAQ),
    );
  }
  if (path === "/pricing") graph.push(faq(PRICING_FAQ));
  return { "@context": "https://schema.org", "@graph": graph };
}

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Keeps <head> right for a public page after in-app navigation (the prerendered HTML already has it on first load). */
export function useSeo(path: PublicPath) {
  useEffect(() => {
    const page = PUBLIC_PAGES[path];
    const url = canonicalUrl(path);
    document.title = page.title;
    setMeta("name", "description", page.description);
    setMeta("property", "og:title", page.title);
    setMeta("property", "og:description", page.description);
    setMeta("property", "og:url", url);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = url;
  }, [path]);
}
