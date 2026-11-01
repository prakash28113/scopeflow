/** Public site facts shown on the landing page, legal pages and sign-in help. */
export const SUPPORT_EMAIL = "prakashmummidisetti@gmail.com";
export const LEGAL_UPDATED = "1 November 2026";
export const supportMailto = (subject: string) => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
