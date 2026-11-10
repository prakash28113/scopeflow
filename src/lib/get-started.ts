/**
 * The dashboard's "Get started" checklist (T2-13). Each step ticks itself from real data; nothing
 * is ticked by hand. "Activated" means the account has created an approval link (step 3), the same
 * definition public.admin_activation() uses.
 */
export type GetStartedCounts = { clients: number; projects: number; linksSent: number; requests: number };
export type GetStartedStep = { key: "client" | "scope" | "link" | "request"; label: string; hint: string; to: string; done: boolean };

export function getStartedSteps(c: GetStartedCounts, draftProjectId: string | null = null, liveProjectId: string | null = null): GetStartedStep[] {
  return [
    { key: "client", label: "Add a client", hint: "A name and an email are enough.", to: "/clients?new=1", done: c.clients > 0 },
    { key: "scope", label: "Write a scope", hint: "Start from a template and edit it.", to: "/projects/new", done: c.projects > 0 },
    {
      key: "link",
      label: "Send the approval link",
      hint: "Your client approves on their phone. No account needed.",
      to: draftProjectId ? `/projects/${draftProjectId}` : c.projects > 0 ? "/projects" : "/projects/new",
      done: c.linksSent > 0,
    },
    {
      key: "request",
      label: "Log a client request",
      hint: "A change asked for on WhatsApp or a call: record it, and see if it's an extra.",
      to: liveProjectId ? `/projects/${liveProjectId}/record` : "/projects",
      done: c.requests > 0,
    },
  ];
}

export const stepsDone = (steps: GetStartedStep[]) => steps.filter((s) => s.done).length;

/** Shown until every step is done or the person closes it. */
export const showGetStarted = (steps: GetStartedStep[], dismissed: boolean) => !dismissed && stepsDone(steps) < steps.length;

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
const key = (userId: string) => `sf-get-started-dismissed:${userId}`;
export function isDismissed(userId: string, store: Store | null = local()): boolean {
  try {
    return store?.getItem(key(userId)) === "1";
  } catch {
    return false;
  }
}
export function dismiss(userId: string, store: Store | null = local()): void {
  try {
    store?.setItem(key(userId), "1");
  } catch {
    /* it just comes back next time */
  }
}
