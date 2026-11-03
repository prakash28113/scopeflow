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
  /** Paid features: analytics (with expenses) and exports (approval-record PDF). */
  features?: Record<PlanFeature, boolean>;
  usage: { active_projects: number; clients: number };
  early_access: { plan: PlanId; billing_interval: Interval; created_at: string } | null;
};

export type PlanFeature = "analytics" | "exports";

/**
 * Whether the signed-in account's plan includes a feature. While loading (or against a database that
 * doesn't report features yet) it answers true, so nothing flashes locked; the database enforces it anyway.
 */
export function useFeature(feature: PlanFeature): boolean {
  const q = useMyPlan();
  return q.data?.features?.[feature] ?? true;
}

/** "₹499/month": the Solo monthly price from the catalogue, for upgrade prompts. */
export function useSoloPrice(): string {
  const q = usePlans();
  const solo = q.data?.find((p) => p.id === "solo");
  return solo ? `${formatPrice(solo.monthly_price_cents, solo.currency)}/month` : "₹499/month";
}

export type Invoice = { id: string; amount_cents: number; currency: string; status: string; paid_at: string | null; provider_invoice_id: string };

/** The public plan catalogue. Also prefetched at build time so the prerendered pricing page shows real plans. */
export const plansQuery = {
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
};

export function usePlans() {
  return useQuery(plansQuery);
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

/** A plan price: whole amounts without decimals (₹4,999, not ₹4,999.00). */
export function formatPrice(minor: number, currency: string) {
  if (minor % 100 !== 0) return formatMoney(minor, currency);
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}

/** Price shown on a plan card for the chosen billing interval. */
export function priceLabel(plan: Plan, interval: Interval) {
  const money = (n: number) => formatPrice(n, plan.currency);
  if (plan.monthly_price_cents === 0) return { main: money(0), per: "forever", note: null as string | null };
  if (interval === "month") return { main: money(plan.monthly_price_cents), per: "/month", note: null };
  const perMonth = Math.round(plan.annual_price_cents / 1200) * 100;
  const saved = plan.monthly_price_cents * 12 - plan.annual_price_cents;
  return {
    main: money(plan.annual_price_cents),
    per: "/year",
    note: `about ${money(perMonth)}/month · save ${money(saved)} a year`,
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
