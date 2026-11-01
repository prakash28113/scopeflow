/** Subscription plans: catalogue (public), the signed-in account's plan, and display helpers. */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { formatMoney } from "./money";

export type PlanId = "free" | "solo" | "studio";
export type Interval = "month" | "year";
export type SubscriptionStatus = "free" | "trialing" | "active" | "past_due" | "cancelled" | "expired";

export type Plan = {
  id: PlanId;
  name: string;
  position: number;
  currency: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  max_active_projects: number | null;
  max_clients: number | null;
  max_team_members: number;
  purchasable: boolean;
};

export type MyPlan = {
  plan: PlanId;
  status: SubscriptionStatus;
  effective_plan: PlanId;
  billing_interval: Interval | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_until: string | null;
  limits: { active_projects: number | null; clients: number | null; team_members: number };
  usage: { active_projects: number; clients: number };
  early_access: { plan: PlanId; billing_interval: Interval; created_at: string } | null;
};

export type Invoice = { id: string; amount_cents: number; currency: string; status: string; paid_at: string | null; provider_invoice_id: string };

export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("id, name, position, currency, monthly_price_cents, annual_price_cents, max_active_projects, max_clients, max_team_members, purchasable")
        .order("position");
      if (error) throw error;
      return data as Plan[];
    },
  });
}

export function useMyPlan(enabled = true) {
  return useQuery({
    queryKey: ["my-plan"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_plan");
      if (error) throw error;
      return data as MyPlan;
    },
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("id, amount_cents, currency, status, paid_at, provider_invoice_id").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Invoice[];
    },
  });
}

export const STATUS_TEXT: Record<SubscriptionStatus, string> = {
  free: "Free",
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Price shown on a plan card for the chosen billing interval. */
export function priceLabel(plan: Plan, interval: Interval) {
  if (plan.monthly_price_cents === 0) return { main: formatMoney(0, plan.currency), per: "forever", note: null as string | null };
  if (interval === "month") return { main: formatMoney(plan.monthly_price_cents, plan.currency), per: "/month", note: null };
  const perMonth = Math.round(plan.annual_price_cents / 12);
  const saved = plan.monthly_price_cents * 12 - plan.annual_price_cents;
  return {
    main: formatMoney(plan.annual_price_cents, plan.currency),
    per: "/year",
    note: `${formatMoney(perMonth, plan.currency)}/month · save ${formatMoney(saved, plan.currency)} a year`,
  };
}

export const limitText = (n: number | null, noun: string) => (n === null ? `Unlimited ${noun}` : `${n} ${noun}`);

export type PlanLimit = { kind: "active_projects" | "clients"; limit: number; used: number; plan: PlanId; message: string };

/** Recognises the database's plan-limit error (SQLSTATE SF402). */
export function planLimitFrom(error: { code?: string; message?: string; hint?: string; details?: string } | null | undefined): PlanLimit | null {
  if (!error || error.code !== "SF402") return null;
  let d: { limit?: number; used?: number; plan?: PlanId } = {};
  try {
    d = JSON.parse(error.details ?? "{}");
  } catch {
    /* keep defaults */
  }
  return {
    kind: error.hint === "plan_limit:clients" ? "clients" : "active_projects",
    limit: Number(d.limit ?? 0),
    used: Number(d.used ?? 0),
    plan: d.plan ?? "free",
    message: error.message ?? "You've reached your plan's limit.",
  };
}
