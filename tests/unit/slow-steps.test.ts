import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { warmAccount } from "@/lib/warm";
import { timeEnd, timeStart } from "@/lib/timing";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("T2-03 after sign-in, profile, plan and the first screen's code load together", () => {
  it("starts every fetch before any of them finishes (mocked timings)", async () => {
    let clock = 0;
    const log: string[] = [];
    const slow = (name: string, ms: number) => () =>
      new Promise<string>((resolve) => {
        log.push(`start ${name} @${clock}`);
        setTimeout(() => {
          clock = Math.max(clock, ms);
          log.push(`done ${name} @${ms}`);
          resolve(name);
        }, ms);
      });
    const qc = { prefetchQuery: (o: { queryFn: () => Promise<unknown> }) => o.queryFn().then(() => undefined) };
    const t0 = Date.now();
    await warmAccount(qc as never, [{ queryKey: ["profile", "u1"], queryFn: slow("profile", 60) }, { queryKey: ["my-plan"], queryFn: slow("plan", 40) }], [slow("dashboard code", 50)]);
    expect(log.slice(0, 3)).toEqual(["start profile @0", "start plan @0", "start dashboard code @0"]);
    expect(log.slice(3)).toEqual(["done plan @40", "done dashboard code @50", "done profile @60"]);
    // In parallel the wait is the slowest one (60 ms), not the sum (150 ms).
    expect(Date.now() - t0).toBeLessThan(140);
  });
  it("a failed fetch doesn't stop the others or throw", async () => {
    const done: string[] = [];
    const qc = { prefetchQuery: (o: { queryFn: () => Promise<unknown> }) => o.queryFn().then(() => undefined).catch(() => undefined) };
    await warmAccount(qc as never, [{ queryKey: ["a"], queryFn: async () => { throw new Error("offline"); } }, { queryKey: ["b"], queryFn: async () => void done.push("b") }], [async () => { throw new Error("chunk"); }]);
    expect(done).toEqual(["b"]);
  });
  it("is wired to the moment the session exists, and sign-in navigates without waiting for it", () => {
    const auth = src("src/lib/auth.tsx");
    expect(auth).toContain("warmAccount(qc, [profileQuery(userId), myPlanQuery], [pages.dashboard])");
    expect(auth).toMatch(/event === "SIGNED_IN" && session\) \{\s+timeEnd\("sign-in:session"\);\s+warm\(qc, session\.user\.id\);/);
    const login = src("src/routes/auth.tsx");
    expect(login).toMatch(/if \(error\) return f\.setError\(signInError\(error\)\);\s+navigate\(next, \{ replace: true \}\);/);
    // No artificial delay anywhere in the sign-in or reset paths.
    const signIn = login.slice(login.indexOf('timeStart("sign-in")'), login.indexOf("navigate(next, { replace: true });"));
    const reset = login.slice(login.indexOf('timeStart("reset-request")'), login.indexOf('timeEnd("reset-request")'));
    expect((signIn + reset).match(/setTimeout|sleep\(|delay/g) ?? []).toEqual([]);
  });
});

describe("T2-03 step timings", () => {
  function fakePerf() {
    const marks = new Map<string, number>();
    let now = 0;
    return {
      tick: (ms: number) => void (now += ms),
      mark: (n: string) => (marks.set(n, now), undefined as never),
      clearMarks: (n?: string) => void (n ? marks.delete(n) : marks.clear()),
      getEntriesByName: (n: string) => (marks.has(n) ? [{} as PerformanceEntry] : []),
      measure: (_n: string, start: string) => ({ duration: now - marks.get(start)! }) as PerformanceMeasure,
    };
  }
  it("measures a step once, and says nothing about who did it", () => {
    const p = fakePerf();
    const lines: string[] = [];
    timeStart("checkout-open", p);
    p.tick(1234);
    expect(timeEnd("checkout-open", p, (m) => lines.push(m))).toBe(1234);
    expect(lines).toEqual(["[timing] checkout-open: 1234 ms"]);
    expect(timeEnd("checkout-open", p, (m) => lines.push(m))).toBeNull(); // not started again
    expect(timeEnd("pdf", null)).toBeNull();
  });
  it("covers the five slow paths", () => {
    expect(src("src/routes/auth.tsx")).toContain('timeStart("sign-in")');
    expect(src("src/routes/dashboard.tsx")).toContain('timeEnd("sign-in")');
    expect(src("src/routes/auth.tsx")).toContain('timeEnd("reset-request")');
    expect(src("src/lib/billing.ts")).toMatch(/rzp\.open\(\);\s+timeEnd\("checkout-open"\);/);
    expect(src("src/components/create-invoice.tsx")).toContain('timeEnd("invoice-create")');
    expect(src("src/components/quote.tsx")).toContain('timeEnd("pdf")');
  });
  it("checkout and the PDF code are fetched ahead of the click", () => {
    expect(src("src/routes/plan.tsx")).toContain("if (mayBuy) preloadCheckout();");
    expect(src("src/routes/pricing.tsx")).toContain("onSoloIntent={session && !solo.current ? preloadCheckout : undefined}");
    expect(src("src/components/quote.tsx")).toContain("useEffect(() => whenIdle(prefetchPdf), []);");
    // Invoice creation is already one round-trip.
    expect(src("src/components/create-invoice.tsx").match(/supabase\.(rpc|from)\(/g)).toEqual(["supabase.rpc("]);
  });
});
