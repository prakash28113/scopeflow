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

export function buildCsp(opts: { supabaseUrl: string; turnstile: boolean }): string {
  const supabase = new URL(opts.supabaseUrl).origin;
  const t = opts.turnstile ? ` ${TURNSTILE_ORIGIN}` : "";
  return [
    "default-src 'self'",
    `script-src 'self'${t}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabase}${t}`,
    `frame-src ${opts.turnstile ? TURNSTILE_ORIGIN : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join("; ");
}

export function buildHeadersFile(opts: { supabaseUrl: string; turnstile: boolean }): string {
  return `/*
  Content-Security-Policy: ${buildCsp(opts)}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin

/p
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
