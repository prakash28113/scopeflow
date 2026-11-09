/**
 * "I came for Solo": the plan someone picked on the pricing page, carried through sign-up, the
 * email-confirmation link and set-up, so they land on Plan & usage with Solo ready to buy.
 * It never opens a payment by itself: the person still presses Upgrade.
 *
 * Carried two ways, so it survives a confirmation link opened later or in another tab:
 *  - in the address (?plan=solo&interval=monthly|yearly), and
 *  - in this browser's storage for a week, cleared as soon as it's used.
 */
import type { Interval } from "./plans";

export type PlanIntent = { plan: "solo"; interval: Interval };

/** The Solo button on the public pricing page. Owner: change to "Get Solo: ₹499/month" after the test purchase passes. */
export const SOLO_CTA_LABEL = "Start free, upgrade anytime";

const KEY = "sf-plan-intent";
export const INTENT_TTL_MS = 7 * 86_400_000;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const WORD: Record<Interval, "monthly" | "yearly"> = { month: "monthly", year: "yearly" };

/** Reads ?plan=solo&interval=monthly|yearly. Anything else (including ?plan=early) is no intent. */
export function parseIntent(search: string | URLSearchParams): PlanIntent | null {
  const q = typeof search === "string" ? new URLSearchParams(search.replace(/^[^?]*\?/, "")) : search;
  if (q.get("plan") !== "solo") return null;
  return { plan: "solo", interval: q.get("interval") === "yearly" ? "year" : "month" };
}

export const intentQuery = (i: PlanIntent) => `plan=${i.plan}&interval=${WORD[i.interval]}`;
export const planUrl = (i: PlanIntent) => `/plan?${intentQuery(i)}`;
export const signupUrl = (i: PlanIntent) => `/signup?${intentQuery(i)}`;
export const onboardingUrl = (i: PlanIntent | null) => (i ? `/onboarding?${intentQuery(i)}` : "/onboarding");

/**
 * /onboarding opened by an account that has already finished set-up: there's nothing to do there.
 * Returns where to send them (the pending plan, else the dashboard), or null to show set-up.
 */
export const alreadySetUp = (onboardedAt: string | null | undefined, i: PlanIntent | null): string | null => (onboardedAt ? (i ? planUrl(i) : "/dashboard") : null);

/** After set-up: Plan & usage with the plan selected, or the usual first-project screen. */
export const afterOnboarding = (i: PlanIntent | null) => (i ? planUrl(i) : "/projects/new?welcome=1");

export function rememberIntent(i: PlanIntent, now = Date.now(), store: Store | null = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify({ ...i, at: now }));
  } catch {
    /* private mode: the address still carries it */
  }
}

export function readIntent(now = Date.now(), store: Store | null = storage()): PlanIntent | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { plan?: unknown; interval?: unknown; at?: unknown };
    if (v.plan !== "solo" || (v.interval !== "month" && v.interval !== "year") || typeof v.at !== "number" || now - v.at > INTENT_TTL_MS) {
      store?.removeItem(KEY);
      return null;
    }
    return { plan: "solo", interval: v.interval };
  } catch {
    return null;
  }
}

export function clearIntent(store: Store | null = storage()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Use it once: returns the remembered intent and forgets it. */
export function takeIntent(now = Date.now(), store: Store | null = storage()): PlanIntent | null {
  const i = readIntent(now, store);
  clearIntent(store);
  return i;
}

/** Where the Solo button on the pricing page goes, and what it says. */
export function soloCta(who: { signedIn: boolean; effectivePlan?: string | null; planName?: string | null }, interval: Interval): { to: string; label: string; current: boolean } {
  const intent: PlanIntent = { plan: "solo", interval };
  if (!who.signedIn) return { to: signupUrl(intent), label: SOLO_CTA_LABEL, current: false };
  if (who.effectivePlan && who.effectivePlan !== "free") return { to: "/plan", label: `You're on ${who.planName ?? "Solo"}`, current: true };
  return { to: planUrl(intent), label: SOLO_CTA_LABEL, current: false };
}
