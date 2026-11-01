/**
 * Builds the Cloudflare static-assets `_headers` file. Pure function so the
 * policy can be unit-tested (tests/unit/security-headers.test.ts).
 *
 * Turnstile (only when a site key is configured), per Cloudflare's CSP guidance:
 *   script-src  https://challenges.cloudflare.com   (loads api.js)
 *   frame-src   https://challenges.cloudflare.com   (renders the widget iframe)
 *   connect-src https://challenges.cloudflare.com   (exact origin; covers widget/script requests
 *               made from the page; pre-clearance additionally needs 'self', which is always present)
 * Nothing else is broadened: no wildcards, no 'unsafe-eval', no inline scripts.
 */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
/**
 * Cloudflare Web Analytics (free, cookieless visit counts), added by Cloudflare's automatic setup:
 *   script-src  https://static.cloudflareinsights.com  (beacon.min.js)
 *   connect-src https://cloudflareinsights.com         (sends the page-view beacon)
 */
export const ANALYTICS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";
export const ANALYTICS_BEACON_ORIGIN = "https://cloudflareinsights.com";

export function buildCsp(opts: { supabaseUrl: string; turnstile: boolean }): string {
  const supabase = new URL(opts.supabaseUrl).origin;
  const t = opts.turnstile ? ` ${TURNSTILE_ORIGIN}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS_SCRIPT_ORIGIN}${t}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${ANALYTICS_BEACON_ORIGIN}${t}`,
    `frame-src ${opts.turnstile ? TURNSTILE_ORIGIN : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join("; ");
}

/** Headers every page gets (also used by the Worker for its page fallback). */
export function pageHeaders(opts: { supabaseUrl: string; turnstile: boolean }): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(opts),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** Extra headers for the client portal: never indexed, never cached. */
export const PORTAL_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

/** Pages that carry one-time secrets in the address (client links, reset links): never indexed or cached. */
export const PRIVATE_PATHS = ["/p", "/reset-password", "/forgot-password"] as const;

const block = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `  ${k}: ${v}`).join("\n");

export function buildHeadersFile(opts: { supabaseUrl: string; turnstile: boolean }): string {
  return `/*
${block(pageHeaders(opts))}

${PRIVATE_PATHS.map((p) => `${p}\n${block(PORTAL_HEADERS)}\n`).join("\n")}
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
