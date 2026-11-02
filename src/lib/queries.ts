import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { portalRpc } from "./portal-rpc";
import type {
  ActivityEntry,
  ChangeOrder,
  Client,
  Deliverable,
  Milestone,
  PortalView,
  Project,
  RevisionRequest,
  ScopeDecision,
  ScopeSnapshot,
  ShareLinkStatus,
} from "./types";

/** Throws PostgREST errors so React Query surfaces them. */
function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

export type DashboardProject = Project & {
  clients: { name: string; company: string | null };
  milestones: { id: string; title: string; amount_cents: number; status: string; due_date: string | null; paid_cents?: number }[];
  deliverables?: { id: string; title: string; due_date: string | null; progress?: string }[];
};

export function useDashboard(enabled = true) {
  return useQuery({
    queryKey: ["dashboard"],
    enabled,
    queryFn: async () => {
      const [projects, changeOrders, revisions, activity, snapshots, invoices, links, followUps, payments] = await Promise.all([
        supabase.from("projects").select("*, clients(name, company), milestones(id, title, amount_cents, status, due_date, paid_cents), deliverables(id, title, due_date, progress)").order("updated_at", { ascending: false }),
        supabase
          .from("change_orders")
          .select("id, number, title, amount_cents, created_at, project_id, projects(title, currency)")
          .eq("status", "sent")
          .order("created_at", { ascending: false }),
        supabase
          .from("revision_requests")
          .select("id, kind, in_scope, description, created_at, project_id, projects(title)")
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("activity_log")
          .select("id, summary, actor, created_at, project_id, projects(title)")
          .order("created_at", { ascending: false })
          .limit(8),
        // For reminders: when each scope was last sent, invoices, client links and follow-ups.
        supabase.from("scope_snapshots").select("project_id, created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("client_invoices").select("id, number, due_date, amount_cents, currency, project_id, voided_at, milestone_id, milestones(status, paid_cents)").is("voided_at", null),
        supabase.from("share_links").select("project_id, expires_at, revoked_at").is("revoked_at", null),
        supabase.from("follow_ups").select("id, due_on, note, project_id, done_at").is("done_at", null).order("due_on"),
        // Money received, by day: the overview's "money in" trend.
        supabase.from("payments").select("amount_cents, paid_on, project_id").order("paid_on"),
      ]);
      return {
        projects: unwrap(projects) as DashboardProject[],
        changeOrders: unwrap(changeOrders) as unknown as {
          id: string; number: number; title: string; amount_cents: number; created_at: string; project_id: string;
          projects: { title: string; currency: string };
        }[],
        revisions: unwrap(revisions) as unknown as {
          id: string; kind: string; in_scope: boolean; description: string; created_at: string; project_id: string;
          projects: { title: string };
        }[],
        activity: unwrap(activity) as unknown as (ActivityEntry & { projects: { title: string } })[],
        snapshots: unwrap(snapshots) as { project_id: string; created_at: string }[],
        invoices: unwrap(invoices) as unknown as {
          id: string; number: string; due_date: string | null; amount_cents: number; currency: string; project_id: string;
          voided_at: string | null; milestone_id: string | null; milestones: { status: string; paid_cents: number } | null;
        }[],
        links: unwrap(links) as { project_id: string; expires_at: string; revoked_at: string | null }[],
        followUps: unwrap(followUps) as { id: string; due_on: string; note: string; project_id: string | null; done_at: string | null }[],
        payments: unwrap(payments) as { amount_cents: number; paid_on: string; project_id: string }[],
      };
    },
  });
}

export type FullProject = Project & { clients: Client; deliverables: Deliverable[]; milestones: Milestone[] };

/** Everything the project page shows, fetched in one round (all requests at once). */
export function projectQuery(id: string) {
  return {
    queryKey: ["project", id],
    queryFn: async () => {
      const [projectRes, snapshots, decisions, revisions, changeOrders, activity, links, invoices, payments, followUps, expenses] = await Promise.all([
        supabase.from("projects").select("*, clients(*), deliverables(*), milestones(*)").eq("id", id).maybeSingle(),
        supabase.from("scope_snapshots").select("*").eq("project_id", id).order("version", { ascending: false }),
        supabase.from("scope_decisions").select("*").eq("project_id", id),
        supabase.from("revision_requests").select("*").eq("project_id", id).order("created_at", { ascending: false }),
        supabase.from("change_orders").select("*").eq("project_id", id).order("number", { ascending: false }),
        supabase.from("activity_log").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(60),
        supabase
          .from("share_links")
          .select("id, project_id, created_at, expires_at, revoked_at")
          .eq("project_id", id)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase.from("client_invoices").select("id, number, milestone_id, voided_at, amount_cents, currency").eq("project_id", id),
        supabase.from("payments").select("*").eq("project_id", id).order("paid_on", { ascending: true }),
        supabase.from("follow_ups").select("id, due_on, note, done_at").eq("project_id", id).is("done_at", null).order("due_on"),
        supabase.from("expenses").select("amount_cents, currency").eq("project_id", id),
      ]);
      const project = unwrap(projectRes) as FullProject | null;
      if (!project) return null;
      project.deliverables.sort((a, b) => a.position - b.position);
      project.milestones.sort((a, b) => a.position - b.position);
      return {
        project,
        snapshots: unwrap(snapshots) as ScopeSnapshot[],
        decisions: unwrap(decisions) as ScopeDecision[],
        revisions: unwrap(revisions) as RevisionRequest[],
        changeOrders: unwrap(changeOrders) as ChangeOrder[],
        activity: unwrap(activity) as ActivityEntry[],
        link: ((unwrap(links) as ShareLinkStatus[])[0] ?? null) as ShareLinkStatus | null,
        invoices: unwrap(invoices) as { id: string; number: string; milestone_id: string | null; voided_at: string | null }[],
        payments: unwrap(payments) as import("./payments").PaymentRecord[],
        followUps: unwrap(followUps) as { id: string; due_on: string; note: string; done_at: string | null }[],
        expenses: unwrap(expenses) as { amount_cents: number; currency: string }[],
      };
    },
  };
}

export function useProject(id: string | undefined) {
  return useQuery({ ...projectQuery(id ?? ""), enabled: Boolean(id) });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications", "list"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("activity_log")
          .select("id, summary, event, actor_name, created_at, project_id, projects(title)")
          .eq("actor", "client")
          .order("created_at", { ascending: false })
          .limit(50),
      ) as unknown as (ActivityEntry & { projects: { title: string } })[],
  });
}

export function usePortal(token: string | null) {
  return useQuery({
    queryKey: ["portal", token],
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await portalRpc<PortalView>("portal_view", { p_token: token });
      if (error) throw error;
      return data as PortalView;
    },
  });
}
