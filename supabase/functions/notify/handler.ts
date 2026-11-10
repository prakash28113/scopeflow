/**
 * ScopeFlow owner notifications: emails the freelancer (never the client) when their client
 * approves the scope, asks for changes, or approves / declines a change order.
 *
 *   POST /notify/flush   no body, no sign-in → sends up to 10 queued emails → { sent, failed }
 *
 * The queue (public.owner_emails) is filled by a database trigger when the client acts. This
 * function only empties it, so anyone calling it can at most make already-queued emails go out
 * sooner. The client's page calls it after an action, and the site's scheduled job calls it as a
 * safety net. Plain text only: no tracking pixel, no rewritten links, no client contact details.
 * Sent through Brevo's API with BREVO_API_KEY (a function secret). Without the key nothing is
 * claimed or sent. Plain web APIs only (runs in Deno, Node and tests).
 */

export type NotifyConfig = { supabaseUrl: string; serviceKey: string; brevoKey: string; siteUrl: string; fromEmail: string; fromName: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type QueuedEmail = {
  id: string;
  kind: "scope_approved" | "changes_requested" | "change_order_decided";
  event: string;
  actor_name: string | null;
  summary: string;
  project_id: string;
  project_title: string;
  to_email: string;
  to_name: string | null;
};

const BREVO = "https://api.brevo.com/v3/smtp/email";
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

/** One line, no line breaks or control characters (a client's name can't add headers or lines). */
const line = (s: string | null | undefined, max = 160) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const WHAT: Record<string, (who: string) => { subject: string; did: string; next: string }> = {
  "scope.approved": (who) => ({ subject: "approved the scope", did: `${who} approved the scope.`, next: "It's now locked as the reference for revisions and extras." }),
  "scope.rejected": (who) => ({ subject: "asked for changes to the scope", did: `${who} asked for changes to the scope before approving.`, next: "Read what they asked for, update the scope and send it again." }),
  "revision.requested": (who) => ({ subject: "requested a revision", did: `${who} requested a revision.`, next: "Check whether it's inside the agreed scope or an extra." }),
  "change_order.approved": (who) => ({ subject: "approved a change order", did: `${who} approved a change order.`, next: "The extra work is agreed. You can start on it." }),
  "change_order.rejected": (who) => ({ subject: "declined a change order", did: `${who} declined a change order.`, next: "The extra work isn't agreed. The original scope still stands." }),
};

/** The email for one queued event: subject and plain-text body. Null for an event with no email. */
export function renderOwnerEmail(e: QueuedEmail, siteUrl: string): { subject: string; text: string } | null {
  const make = WHAT[e.event];
  if (!make) return null;
  const who = line(e.actor_name, 80) || "Your client";
  const project = line(e.project_title, 120) || "your project";
  const w = make(who);
  const detail = line(e.summary, 300);
  const text = [
    e.to_name ? `Hi ${line(e.to_name, 80)},` : "Hi,",
    "",
    `${w.did}`,
    `Project: ${project}`,
    ...(detail ? [`Note in the timeline: ${detail}`] : []),
    "",
    w.next,
    "",
    `Open the project: ${siteUrl}/projects/${e.project_id}`,
    "",
    "You're getting this because your client acted on a ScopeFlow link you sent.",
    `Turn these emails off in Settings → Notifications: ${siteUrl}/settings`,
    "",
    "ScopeFlow",
  ].join("\n");
  return { subject: `${who} ${w.subject}: ${project}`, text };
}

async function rpc<T>(cfg: NotifyConfig, f: Fetch, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await f(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} failed (${res.status})`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function send(cfg: NotifyConfig, f: Fetch, e: QueuedEmail): Promise<void> {
  const mail = renderOwnerEmail(e, cfg.siteUrl);
  if (!mail) return; // nothing to say: marked done so it isn't tried again
  const res = await f(BREVO, {
    method: "POST",
    headers: { "api-key": cfg.brevoKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: cfg.fromName, email: cfg.fromEmail },
      to: [{ email: e.to_email, ...(e.to_name ? { name: line(e.to_name, 80) } : {}) }],
      subject: mail.subject,
      textContent: mail.text,
      tags: ["owner-notification"],
    }),
  });
  if (!res.ok) throw new Error(`Brevo answered ${res.status}`);
}

export async function handleNotify(req: Request, cfg: NotifyConfig, f: Fetch = fetch): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" || !path.endsWith("/flush")) return reply(404, { error: "Not found" });
  if (!cfg.supabaseUrl || !cfg.serviceKey || !cfg.brevoKey) return reply(200, { configured: false, sent: 0, failed: 0 });
  let queue: QueuedEmail[];
  try {
    queue = (await rpc<QueuedEmail[]>(cfg, f, "notify_claim", { p_limit: 10 })) ?? [];
  } catch {
    return reply(200, { configured: true, sent: 0, failed: 0, error: "queue" });
  }
  let sent = 0;
  let failed = 0;
  for (const e of queue) {
    let ok = true;
    let error: string | null = null;
    try {
      await send(cfg, f, e);
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : "failed";
    }
    if (ok) sent++;
    else failed++;
    // Best effort: if this fails the email is tried again later (at most 5 times in all).
    await rpc(cfg, f, "notify_mark", { p_id: e.id, p_ok: ok, p_error: error }).catch(() => {});
  }
  return reply(200, { configured: true, sent, failed });
}

export function notifyConfigFromEnv(get: (name: string) => string | undefined): NotifyConfig {
  return {
    supabaseUrl: String(get("SUPABASE_URL") ?? "").replace(/\/+$/, ""),
    serviceKey: get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    brevoKey: String(get("BREVO_API_KEY") ?? "").trim(),
    siteUrl: String(get("SITE_URL") || "https://scopeflow.in").replace(/\/+$/, ""),
    fromEmail: String(get("NOTIFY_FROM_EMAIL") || "no-reply@scopeflow.in").trim(),
    fromName: "ScopeFlow",
  };
}
