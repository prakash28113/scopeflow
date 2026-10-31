import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * Emits dist/_headers for Cloudflare static assets. The CSP is pinned to the
 * configured Supabase origin, so the page can only talk to your own project.
 */
function securityHeaders(env: Record<string, string>): Plugin {
  return {
    name: "scopeflow-security-headers",
    apply: "build",
    generateBundle() {
      const supabaseUrl = env.VITE_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL must be set when building");
      const supabase = new URL(supabaseUrl).origin;
      const turnstile = env.VITE_TURNSTILE_SITE_KEY ? " https://challenges.cloudflare.com" : "";
      const csp = [
        "default-src 'self'",
        `script-src 'self'${turnstile}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src 'self' ${supabase}`,
        `frame-src ${turnstile ? turnstile.trim() : "'none'"}`,
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; ");
      const headers = `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin

/p
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
      this.emitFile({ type: "asset", fileName: "_headers", source: headers });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), tailwindcss(), securityHeaders(env)],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: { target: "es2022", sourcemap: false },
  };
});
