import siteConfig from "../../config/public-site.json";

/** True once real email (SMTP) is set up in Supabase, so reset emails reach everyone. */
export const PASSWORD_RESET_EMAIL: boolean = siteConfig.passwordResetEmail === true;

/** Public site facts shown on the landing page, legal pages and sign-in help. */
export const SUPPORT_EMAIL = "prakashmummidisetti@gmail.com";
export const LEGAL_UPDATED = "1 November 2026";
export const supportMailto = (subject: string) => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
