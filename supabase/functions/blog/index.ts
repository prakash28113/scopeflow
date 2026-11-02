// Supabase Edge Function entry point (Deno). The logic lives in handler.ts.
// Deployed with JWT verification off: callers authenticate with a publishing key instead.
import { blogConfigFromEnv, handleBlogApi } from "./handler.ts";

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const config = blogConfigFromEnv((name) => Deno.env.get(name));
Deno.serve((req) => handleBlogApi(req, config));
