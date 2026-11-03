import siteConfig from "../../config/public-site.json";

/** True once real email (SMTP) is set up in Supabase, so reset emails reach everyone. */
export const PASSWORD_RESET_EMAIL: boolean = siteConfig.passwordResetEmail === true;

/** Google OAuth Client ID (public). Empty → no "Continue with Google" button. Tests override it with VITE_GOOGLE_CLIENT_ID. */
export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? String(siteConfig.googleClientId ?? "");

/** Public site facts shown on the landing page, legal pages and sign-in help. */
export { INSTAGRAM_URL, OPERATOR_CITY, OPERATOR_NAME, SUPPORT_EMAIL } from "./operator";
import { SUPPORT_EMAIL } from "./operator";
export const LEGAL_UPDATED = "3 November 2026";
export const supportMailto = (subject: string) => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;

/** "Send feedback": opens the user's own email app with a short prompt. Only the page path is included, never project data. */
export function feedbackMailto(pagePath: string): string {
  const body = [
    "What were you trying to do?",
    "",
    "",
    "What happened, or what would make ScopeFlow better for you?",
    "",
    "",
    `(Page: ${pagePath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")})`,
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ScopeFlow feedback")}&body=${encodeURIComponent(body)}`;
}
