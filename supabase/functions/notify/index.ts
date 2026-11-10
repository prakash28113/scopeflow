// Supabase Edge Function entry point (Deno). The logic lives in handler.ts.
// Deployed with JWT verification off: the client's page (no account) nudges it after an action.
// It only sends emails the database has already queued for account owners.
import { handleNotify, notifyConfigFromEnv } from "./handler.ts";

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const config = notifyConfigFromEnv((name) => Deno.env.get(name));
Deno.serve((req) => handleNotify(req, config));
