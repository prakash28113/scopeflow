/**
 * Lightweight step timings for the slow paths (sign-in, password reset, opening Razorpay, creating
 * an invoice, making a PDF). Uses the browser's performance timeline: visible in DevTools →
 * Performance, and printed to the console in development only. No names, emails or ids are recorded.
 */
export type Step = "sign-in" | "sign-in:session" | "reset-request" | "checkout-open" | "invoice-create" | "pdf";

type Perf = Pick<Performance, "mark" | "measure" | "clearMarks" | "getEntriesByName">;
const perf = (): Perf | null => (typeof performance !== "undefined" && typeof performance.mark === "function" ? performance : null);
const DEV = Boolean(import.meta.env?.DEV);

/** Starts timing a step (restarting it if it was already running). */
export function timeStart(step: Step, p: Perf | null = perf()): void {
  try {
    p?.clearMarks(`sf:${step}`);
    p?.mark(`sf:${step}`);
  } catch {
    /* timing must never break the page */
  }
}

/** Ends a step and returns how long it took, or null if it was never started. */
export function timeEnd(step: Step, p: Perf | null = perf(), log: (m: string) => void = DEV ? (m) => console.info(m) : () => {}): number | null {
  try {
    if (!p || p.getEntriesByName(`sf:${step}`, "mark").length === 0) return null;
    const m = p.measure(`sf:${step}`, `sf:${step}`);
    p.clearMarks(`sf:${step}`);
    const ms = Math.round(m?.duration ?? 0);
    log(`[timing] ${step}: ${ms} ms`);
    return ms;
  } catch {
    return null;
  }
}

/** Runs something off the critical path: when the browser is idle, or shortly after. */
export function whenIdle(fn: () => void): void {
  if (typeof window === "undefined") return;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 2000 });
  else setTimeout(fn, 300);
}
