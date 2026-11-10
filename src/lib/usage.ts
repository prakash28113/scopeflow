/**
 * Two counts for the owner to read later (T2-11): a plan limit was met, and checkout was opened.
 * Nothing personal is sent: only the event and one fixed word. Never blocks or breaks the page.
 */
import { supabase } from "./supabase";

export type CheckoutSource = "limit" | "pricing" | "plan";
type Event = { event: "limit_hit"; detail: "active_projects" | "clients" } | { event: "checkout_open"; detail: CheckoutSource };

const recent = new Map<string, number>();
/** The same event within a minute is one event (a card that re-renders isn't a second limit). */
export function isRepeat(key: string, now = Date.now(), seen: Map<string, number> = recent): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < 60_000) return true;
  seen.set(key, now);
  return false;
}

export function logUsage<E extends Event["event"]>(event: E, detail: Extract<Event, { event: E }>["detail"]): void {
  if (isRepeat(`${event}:${detail}`)) return;
  try {
    void supabase.rpc("log_usage_event", { p_event: event, p_detail: detail }).then(
      () => {},
      () => {},
    );
  } catch {
    /* counting is optional */
  }
}

const KEY = "sf-checkout-source";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): Store | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

/** Where the person pressed Upgrade before reaching Plan & usage (this tab only). */
export function rememberCheckoutSource(source: Exclude<CheckoutSource, "plan">, store: Store | null = session()): void {
  try {
    store?.setItem(KEY, source);
  } catch {
    /* fine */
  }
}

/** The source for the checkout that's opening now: what was remembered (once), else Plan & usage itself. */
export function takeCheckoutSource(store: Store | null = session()): CheckoutSource {
  try {
    const v = store?.getItem(KEY);
    store?.removeItem(KEY);
    return v === "limit" || v === "pricing" ? v : "plan";
  } catch {
    return "plan";
  }
}
