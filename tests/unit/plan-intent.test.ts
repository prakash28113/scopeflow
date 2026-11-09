import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INTENT_TTL_MS, SOLO_CTA_LABEL, afterOnboarding, intentQuery, onboardingUrl, parseIntent, planUrl, readIntent, rememberIntent, signupUrl, soloCta, takeIntent } from "@/lib/plan-intent";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size };
}

describe("T1-02 the Solo button on pricing reaches checkout", () => {
  it("signed out: sign-up with the plan and the interval from the toggle", () => {
    expect(soloCta({ signedIn: false }, "month")).toEqual({ to: "/signup?plan=solo&interval=monthly", label: SOLO_CTA_LABEL, current: false });
    expect(soloCta({ signedIn: false }, "year").to).toBe("/signup?plan=solo&interval=yearly");
  });
  it("signed in on Free: Plan & usage with Solo selected, never sign-up", () => {
    expect(soloCta({ signedIn: true, effectivePlan: "free" }, "month")).toEqual({ to: "/plan?plan=solo&interval=monthly", label: SOLO_CTA_LABEL, current: false });
    expect(soloCta({ signedIn: true, effectivePlan: "free" }, "year").to).toBe("/plan?plan=solo&interval=yearly");
    // While the plan is still loading, the safe target is the same page.
    expect(soloCta({ signedIn: true }, "month").to).toBe("/plan?plan=solo&interval=monthly");
  });
  it("already on Solo or higher: says so and links to the plan page", () => {
    expect(soloCta({ signedIn: true, effectivePlan: "solo", planName: "Solo" }, "month")).toEqual({ to: "/plan", label: "You're on Solo", current: true });
    expect(soloCta({ signedIn: true, effectivePlan: "studio", planName: "Studio" }, "year").label).toBe("You're on Studio");
  });
  it("the label is one constant the owner can change later", () => {
    expect(SOLO_CTA_LABEL).toBe("Start free, upgrade anytime");
    expect(src("src/components/plans.tsx")).not.toContain('"Start free, upgrade anytime"');
    expect(src("src/components/plans.tsx")).not.toContain(">\n                  Start free, upgrade anytime");
  });
  it("reads and writes the address form; ?plan=early is not an intent", () => {
    expect(parseIntent("?plan=solo&interval=yearly")).toEqual({ plan: "solo", interval: "year" });
    expect(parseIntent("/plan?plan=solo")).toEqual({ plan: "solo", interval: "month" });
    expect(parseIntent(new URLSearchParams("plan=solo&interval=nonsense"))).toEqual({ plan: "solo", interval: "month" });
    expect(parseIntent("?plan=early")).toBeNull();
    expect(parseIntent("?plan=studio")).toBeNull();
    expect(parseIntent("")).toBeNull();
    const i = { plan: "solo", interval: "year" } as const;
    expect(intentQuery(i)).toBe("plan=solo&interval=yearly");
    expect(planUrl(i)).toBe("/plan?plan=solo&interval=yearly");
    expect(signupUrl(i)).toBe("/signup?plan=solo&interval=yearly");
    expect(onboardingUrl(i)).toBe("/onboarding?plan=solo&interval=yearly");
    expect(onboardingUrl(null)).toBe("/onboarding");
  });
  it("after set-up: the plan page when there's an intent, otherwise the first-project screen", () => {
    expect(afterOnboarding({ plan: "solo", interval: "month" })).toBe("/plan?plan=solo&interval=monthly");
    expect(afterOnboarding(null)).toBe("/projects/new?welcome=1");
  });
  it("survives a reload between sign-up and set-up, and is cleared after use", () => {
    const store = memory();
    rememberIntent({ plan: "solo", interval: "year" }, 1000, store);
    // a reload: nothing in memory but the store
    expect(readIntent(2000, store)).toEqual({ plan: "solo", interval: "year" });
    expect(takeIntent(3000, store)).toEqual({ plan: "solo", interval: "year" });
    expect(store.size()).toBe(0);
    expect(takeIntent(4000, store)).toBeNull();
  });
  it("expires after a week and ignores anything malformed", () => {
    const store = memory();
    rememberIntent({ plan: "solo", interval: "month" }, 0, store);
    expect(readIntent(INTENT_TTL_MS + 1, store)).toBeNull();
    expect(store.size()).toBe(0);
    store.setItem("sf-plan-intent", '{"plan":"studio","interval":"month","at":1}');
    expect(readIntent(2, store)).toBeNull();
    store.setItem("sf-plan-intent", "not json");
    expect(readIntent(2, store)).toBeNull();
    expect(readIntent(2, null)).toBeNull();
  });
  it("the plan page never opens a payment by itself", () => {
    const plan = src("src/routes/plan.tsx");
    // buy() runs only from the card's button; the intent effect only scrolls, focuses and clears.
    expect(plan.match(/\bbuy\(/g)?.length).toBe(1); // its definition; PlanCards calls it through onBuy
    expect(plan).toContain("clearIntent();");
    expect(plan).toContain('selected={intent && effective.id === "free" ? intent.plan : null}');
  });
  it("Free and Studio buttons are unchanged", () => {
    const cards = src("src/components/plans.tsx");
    expect(cards).toContain('<Link to="/signup" className={cx(buttonClass("secondary"), "w-full")}>\n                    Start free\n                  </Link>');
    expect(cards).toContain('<Link to="/signup?plan=early" className={cx(buttonClass(recommended ? "primary" : "secondary"), "w-full")}>\n                  Start free, join early access\n                </Link>');
  });
});
