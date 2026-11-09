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
/**
 * Sign in with Google (Google Identity Services), only when a Google client ID is configured.
 * Paths per Google's CSP guidance: the client script, its button frame/requests, and its stylesheet.
 */
export const GOOGLE_GSI_SCRIPT = "https://accounts.google.com/gsi/client";
export const GOOGLE_GSI = "https://accounts.google.com/gsi/";
export const GOOGLE_GSI_STYLE = "https://accounts.google.com/gsi/style";
/**
 * Razorpay Checkout (only when paid plans are switched on): checkout.js and its risk script, the
 * payment window (an iframe from api.razorpay.com), its API and telemetry calls, and its images.
 */
export const RAZORPAY = {
  script: ["https://checkout.razorpay.com", "https://cdn.razorpay.com"],
  frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  connect: ["https://api.razorpay.com", "https://lumberjack.razorpay.com", "https://checkout.razorpay.com"],
  img: ["https://*.razorpay.com"],
};
export const ANALYTICS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";
export const ANALYTICS_BEACON_ORIGIN = "https://cloudflareinsights.com";

type HeaderOptions = { supabaseUrl: string; turnstile: boolean; google?: boolean; razorpay?: boolean };

export function buildCsp(opts: HeaderOptions): string {
  const supabase = new URL(opts.supabaseUrl).origin;
  const t = opts.turnstile ? ` ${TURNSTILE_ORIGIN}` : "";
  const g = (src: string) => (opts.google ? ` ${src}` : "");
  const r = (list: string[]) => (opts.razorpay ? ` ${list.join(" ")}` : "");
  const frames = [opts.turnstile ? TURNSTILE_ORIGIN : "", opts.google ? GOOGLE_GSI : "", ...(opts.razorpay ? RAZORPAY.frame : [])].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS_SCRIPT_ORIGIN}${t}${g(GOOGLE_GSI_SCRIPT)}${r(RAZORPAY.script)}`,
    `style-src 'self' 'unsafe-inline'${g(GOOGLE_GSI_STYLE)}`,
    `img-src 'self' data: ${supabase}${r(RAZORPAY.img)}`, // Supabase: blog images (public storage)
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${ANALYTICS_BEACON_ORIGIN}${t}${g(GOOGLE_GSI)}${r(RAZORPAY.connect)}`,
    `frame-src ${frames.length ? frames.join(" ") : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join("; ");
}

/** Headers every page gets (also used by the Worker for its page fallback). */
export function pageHeaders(opts: HeaderOptions): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(opts),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // Google's sign-in button and Razorpay Checkout need to know which site they're on; "strict-origin" sends
    // only https://scopeflow.in, never a path.
    "Referrer-Policy": opts.google || opts.razorpay ? "strict-origin" : "no-referrer",
    // Razorpay's payment window may use the browser's Payment Request API (e.g. saved cards, UPI apps).
    "Permissions-Policy": `camera=(), microphone=(), geolocation=(), payment=(${opts.razorpay ? '"https://api.razorpay.com"' : ""}), usb=()`,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    // Google's sign-in popup and Razorpay's bank/UPI windows must be able to report back to this page.
    "Cross-Origin-Opener-Policy": opts.google || opts.razorpay ? "same-origin-allow-popups" : "same-origin",
  };
}

/** Extra headers for the client portal: never indexed, never cached. */
export const PORTAL_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

/** Pages that carry one-time secrets in the address (client links, reset links): never indexed or cached. */
export const PRIVATE_PATHS = ["/p", "/reset-password", "/forgot-password"] as const;

/**
 * Sign-in and sign-up: useful pages but nothing to find in search, and both are the same app shell,
 * so Google reported them as duplicates. Kept out of the index; links on them are still followed.
 */
export const SIGN_IN_PATHS = ["/login", "/signup"] as const;
export const SIGN_IN_HEADERS: Record<string, string> = { "X-Robots-Tag": "noindex" };

const block = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `  ${k}: ${v}`).join("\n");

export function buildHeadersFile(opts: HeaderOptions): string {
  return `/*
${block(pageHeaders(opts))}

${PRIVATE_PATHS.map((p) => `${p}\n${block(PORTAL_HEADERS)}\n`).join("\n")}
${SIGN_IN_PATHS.map((p) => `${p}\n${block(SIGN_IN_HEADERS)}\n`).join("\n")}
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
