/**
 * Where a sign-up came from: the UTM tags and referring site of the first visit, kept in this browser
 * for 30 days and saved once to the new account's profile (set_signup_source). Nothing else is
 * tracked, and nothing leaves the browser until the person creates an account.
 */
export type SignupSource = { utm_source?: string; utm_medium?: string; utm_campaign?: string; referrer?: string; at: number };

const KEY = "sf-signup-source";
export const SOURCE_TTL_MS = 30 * 86_400_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const clip = (v: string | null | undefined, n: number) => (v ? v.trim().slice(0, n) || undefined : undefined);

function storage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved source, if there is one and it's less than 30 days old. */
export function readSource(now = Date.now(), store: Store | null = storage()): SignupSource | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SignupSource;
    if (typeof s.at !== "number" || now - s.at > SOURCE_TTL_MS) {
      store?.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/**
 * On a visit: remember the first source seen. The referrer counts only when it's another site
 * (not ScopeFlow itself); a visit with no tags and no outside referrer remembers nothing.
 */
export function captureSource(href: string, referrer: string, now = Date.now(), store: Store | null = storage()): SignupSource | null {
  if (!store || readSource(now, store)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const q = url.searchParams;
  let ref: string | undefined;
  try {
    ref = referrer && new URL(referrer).host !== url.host ? clip(referrer, 300) : undefined;
  } catch {
    ref = undefined;
  }
  const s: SignupSource = {
    utm_source: clip(q.get("utm_source"), 100),
    utm_medium: clip(q.get("utm_medium"), 100),
    utm_campaign: clip(q.get("utm_campaign"), 100),
    referrer: ref,
    at: now,
  };
  if (!s.utm_source && !s.utm_medium && !s.utm_campaign && !s.referrer) return null;
  try {
    store.setItem(KEY, JSON.stringify(s));
  } catch {
    return null;
  }
  return s;
}

/** After the account is set up: hand the source over once, then forget it. */
export function takeSource(now = Date.now(), store: Store | null = storage()): Omit<SignupSource, "at"> | null {
  const s = readSource(now, store);
  if (!s) return null;
  try {
    store?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  const { at: _at, ...rest } = s;
  return rest;
}
