import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buttonClass, cx } from "@/components/ui";
import { dismiss, getStartedSteps, isDismissed, showGetStarted, stepsDone } from "@/lib/get-started";

/** How many clients and client requests the account has (two cheap counts; RLS keeps them to the owner). */
function useStartCounts(enabled: boolean) {
  return useQuery({
    queryKey: ["get-started"],
    enabled,
    staleTime: 0, // re-read whenever the dashboard opens, so a step ticks as soon as it's done
    queryFn: async () => {
      const [clients, requests] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("revision_requests").select("id", { count: "exact", head: true }),
      ]);
      return { clients: clients.count ?? 0, requests: requests.count ?? 0 };
    },
  });
}

/** The dashboard's first-run checklist. Ticks from real data; gone after 4 of 4 or when closed. */
export function GetStarted({ userId, projects, linksSent }: { userId: string; projects: { id: string; status: string }[]; linksSent: number }) {
  const [closed, setClosed] = useState(() => isDismissed(userId));
  // Nothing to ask the database once it's closed.
  const counts = useStartCounts(!closed);
  if (closed || !counts.data) return null;
  const steps = getStartedSteps(
    { clients: Math.max(counts.data.clients, projects.length ? 1 : 0), projects: projects.length, linksSent, requests: counts.data.requests },
    projects.find((p) => p.status === "draft")?.id ?? null,
    projects.find((p) => p.status === "active")?.id ?? null,
  );
  if (!showGetStarted(steps, false)) return null;
  const done = stepsDone(steps);
  const next = steps.find((s) => !s.done);
  return (
    <section aria-labelledby="get-started-title" data-testid="get-started" className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="get-started-title" className="text-[15px] font-semibold text-ink">
            Get started
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-2" data-testid="get-started-progress">
            {done} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          className="min-h-9 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-sunken hover:text-ink"
          onClick={() => {
            dismiss(userId);
            setClosed(true);
          }}
        >
          Dismiss
        </button>
      </div>
      <ol className="mt-3 divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.key} data-step={s.key} data-done={s.done} className="flex items-center gap-3 py-2.5">
            <span
              aria-hidden
              className={`grid size-6 shrink-0 place-items-center rounded-full border text-[12px] font-semibold ${s.done ? "border-positive bg-positive text-white" : "border-line-strong text-ink-2"}`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-medium ${s.done ? "text-ink-2 line-through" : "text-ink"}`}>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
              </span>
              {s.done ? null : <span className="block text-[13px] text-ink-2">{s.hint}</span>}
            </span>
            {s.done ? null : (
              <Link to={s.to} className={cx(buttonClass(s === next ? "primary" : "secondary", "sm"), "shrink-0")}>
                {s === next ? "Start" : "Open"}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
