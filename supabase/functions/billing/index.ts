// Supabase Edge Function entry point (Deno). The logic lives in handler.ts.
// Deployed by scripts/ci/release.mjs with JWT verification off, because Razorpay's webhook has no
// Supabase session; checkout, cancel and status verify the user's session themselves.
import { configFromEnv, handleBilling } from "./handler.ts";

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const config = configFromEnv((name) => Deno.env.get(name));
Deno.serve((req) => handleBilling(req, config));
