/**
 * Paid plans through Razorpay Checkout. The app never sees card, UPI or bank details: Razorpay's
 * own payment window collects them. The "billing" Edge Function creates the subscription (with the
 * key secret, which never reaches the browser) and the plan changes only after Razorpay confirms
 * the payment (signed callback or webhook).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Interval, PlanId } from "./plans";
import { checkoutOptions } from "./checkout-options";
import { timeEnd, timeStart } from "./timing";

/** Set at build time when Razorpay keys are configured (scripts/ci/release.mjs). */
export const BILLING_ENABLED = import.meta.env.VITE_BILLING_PROVIDER === "razorpay";
const FUNCTIONS = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/billing`;
const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";

export type BillingStatus = { enabled: boolean; mode: "test" | "live" | null; tester: boolean };
export type Checkout = {
  key_id: string;
  subscription_id: string;
  mode: "test" | "live";
  plan_name: string;
  interval: Interval;
  amount_cents: number;
  currency: string;
  email: string;
  name: string;
};
type RazorpayResponse = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: "payment.failed", cb: (r: { error?: { description?: string } }) => void): void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch(`${FUNCTIONS}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      apikey: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ""),
      "content-type": "application/json",
    },
  }).catch(() => {
    throw new Error("Couldn't reach ScopeFlow. Check your connection and try again.");
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body?.error ?? "Something went wrong. Please try again."));
  return body as T;
}

/** Whether this account can buy right now (live mode: everyone; test mode: the owner's testers). */
export function useBillingStatus(enabled = true) {
  return useQuery({
    queryKey: ["billing-status"],
    enabled: BILLING_ENABLED && enabled,
    staleTime: 10 * 60_000,
    queryFn: () => call<BillingStatus>("status"),
  });
}

let loading: Promise<void> | null = null;
/**
 * Fetches Razorpay's checkout.js ahead of the click (when Plan & usage opens for an account that
 * can buy, or the signed-in Solo button on pricing is hovered or focused), so pressing Upgrade only
 * waits for the subscription to be created. Quiet on failure: the click tries again and explains.
 */
export function preloadCheckout(): void {
  if (!BILLING_ENABLED || typeof window === "undefined") return;
  loadCheckout().catch(() => {});
}

/** Loads Razorpay's checkout.js once. */
export function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_JS;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("Razorpay didn't load.")));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("Couldn't open the payment window. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type CheckoutOutcome = { kind: "paid"; result: string } | { kind: "dismissed" } | { kind: "failed"; message: string };

/**
 * Creates the subscription, opens Razorpay's payment window, and on success sends the signed
 * response back for verification. Resolves when the window closes, with what happened.
 */
export async function buyPlan(plan: PlanId, interval: Interval, onOpen?: () => void): Promise<CheckoutOutcome> {
  timeStart("checkout-open");
  const [c] = await Promise.all([call<Checkout>("checkout", { method: "POST", body: JSON.stringify({ plan, interval }) }), loadCheckout()]);
  return new Promise<CheckoutOutcome>((resolve) => {
    let failure: string | null = null;
    const rzp = new window.Razorpay!({
      ...checkoutOptions(c, location.origin),
      handler: (r: RazorpayResponse) => {
        call<{ result: string; status?: "active" | "pending" }>("verify", { method: "POST", body: JSON.stringify(r) }).then(
          (v) => resolve({ kind: "paid", result: v.result }),
          // The payment went through at Razorpay; the webhook will still switch the plan on.
          () => resolve({ kind: "paid", result: "pending" }),
        );
      },
      modal: {
        confirm_close: true,
        ondismiss: () => resolve(failure ? { kind: "failed", message: failure } : { kind: "dismissed" }),
      },
    });
    // Razorpay keeps the window open after a failure so the person can retry; remember why it failed.
    rzp.on("payment.failed", (r) => {
      failure = r.error?.description || "The payment didn't go through. Nothing was charged.";
    });
    rzp.open();
    timeEnd("checkout-open");
    onOpen?.();
  });
}

export const cancelPlan = () => call<{ ok: boolean; at_period_end?: boolean; already?: boolean }>("cancel", { method: "POST" });
