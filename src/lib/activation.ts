/**
 * After Razorpay's window closes with a payment: the plan switches on only when Razorpay confirms
 * the money is captured (verify says "active", or the webhook arrives). Until then the account
 * stays on Free and Plan & usage waits here, for about a minute.
 */
export const ACTIVATING_TEXT = "Payment received, activating… this can take a minute";
export const ACTIVATION_TRIES = 40;
export const ACTIVATION_DELAY_MS = 1500; // 40 × 1.5 s ≈ 60 s

/** Polls until the account is on a paid plan. True if it switched on in time. */
export async function waitForPaidPlan(
  fetchEffectivePlan: () => Promise<string | null | undefined>,
  { tries = ACTIVATION_TRIES, delayMs = ACTIVATION_DELAY_MS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    let plan: string | null | undefined = null;
    try {
      plan = await fetchEffectivePlan();
    } catch {
      /* a failed read is just another "not yet" */
    }
    if (plan && plan !== "free") return true;
    if (i < tries - 1) await sleep(delayMs);
  }
  return false;
}
