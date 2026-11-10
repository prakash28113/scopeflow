/**
 * Owner notification emails (T2-12). Which ones exist, and the nudge that gets queued ones sent.
 * ScopeFlow emails the account owner only; nothing is ever sent to the client.
 */
/**
 * True when the release found a BREVO_API_KEY and deployed the sender. Until then Settings shows
 * no Notifications section, so the app never promises an email it can't send.
 */
export const OWNER_EMAILS_ENABLED = (import.meta.env?.VITE_OWNER_EMAILS as string | undefined) === "on";

export const NOTIFY_TYPES = [
  { key: "scope_approved", label: "Scope approved", hint: "Your client approved the scope." },
  { key: "changes_requested", label: "Changes requested", hint: "Your client asked for changes to the scope, or requested a revision." },
  { key: "change_order_decided", label: "Change order approved or declined", hint: "Your client answered a change order." },
] as const;
export type NotifyKey = (typeof NOTIFY_TYPES)[number]["key"];
export type NotifyPrefs = Partial<Record<NotifyKey, boolean>>;

/** On unless switched off. */
export const notifyOn = (prefs: NotifyPrefs | null | undefined, key: NotifyKey) => prefs?.[key] !== false;

/**
 * Asks the server to send whatever is queued. Fire-and-forget after a client's action: it has no
 * body, needs no reply, and a failure changes nothing for the client (the site's scheduled job
 * sends anything left over).
 */
export function flushOwnerEmails(supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL as string | undefined, f: typeof fetch | undefined = typeof fetch === "undefined" ? undefined : fetch): void {
  if (!supabaseUrl || !f) return;
  try {
    void f(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/notify/flush`, { method: "POST", mode: "no-cors", keepalive: true }).catch(() => {});
  } catch {
    /* never the client's problem */
  }
}
