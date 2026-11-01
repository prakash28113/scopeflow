import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { buildHeadersFile } from "./build/security-headers.ts";

/** Google client ID: env override (tests) or config/public-site.json. Public by design. */
export function googleClientId(env: Record<string, string>): string {
  if (env.VITE_GOOGLE_CLIENT_ID !== undefined) return env.VITE_GOOGLE_CLIENT_ID;
  try {
    return String(JSON.parse(readFileSync(new URL("./config/public-site.json", import.meta.url), "utf8")).googleClientId ?? "");
  } catch {
    return "";
  }
}

/**
 * Emits dist/_headers for Cloudflare static assets. The CSP is pinned to the
 * configured Supabase origin, so the page can only talk to your own project.
 */
function securityHeaders(env: Record<string, string>): Plugin {
  return {
    name: "scopeflow-security-headers",
    apply: "build",
    generateBundle() {
      if (!env.VITE_SUPABASE_URL) throw new Error("VITE_SUPABASE_URL must be set when building");
      const source = buildHeadersFile({ supabaseUrl: env.VITE_SUPABASE_URL, turnstile: Boolean(env.VITE_TURNSTILE_SITE_KEY), google: Boolean(googleClientId(env)) });
      this.emitFile({ type: "asset", fileName: "_headers", source });
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
