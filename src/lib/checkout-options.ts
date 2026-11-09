import { PRICE_TAX_NOTE } from "./business";
import type { Checkout } from "./billing";

/**
 * What Razorpay's window is opened with, apart from the callbacks. The subscription (and so the
 * amount) comes from the server untouched; the tax note is text only.
 */
export function checkoutOptions(c: Checkout, origin: string) {
  return {
    key: c.key_id,
    subscription_id: c.subscription_id,
    name: "ScopeFlow",
    description: `${c.plan_name} plan, billed ${c.interval === "year" ? "yearly" : "monthly"}${c.mode === "test" ? " (test mode)" : ""}. ${PRICE_TAX_NOTE}`,
    image: `${origin}/icon-512.png`,
    prefill: { name: c.name, email: c.email },
    theme: { color: "#005DD4" },
  };
}
