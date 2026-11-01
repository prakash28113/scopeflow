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
  milestones: { id: string; title: string; amount_cents: number; status: string; due_date: string | null }[];
};

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [projects, changeOrders, revisions, activity] = await Promise.all([
        supabase.from("projects").select("*, clients(name, company), milestones(id, title, amount_cents, status, due_date)").order("updated_at", { ascending: false }),
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
      };
    },
  });
}

export type FullProject = Project & { clients: Client; deliverables: Deliverable[]; milestones: Milestone[] };

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["project", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const project = unwrap(
        await supabase.from("projects").select("*, clients(*), deliverables(*), milestones(*)").eq("id", id!).maybeSingle(),
      ) as FullProject | null;
      if (!project) return null;
      const [snapshots, decisions, revisions, changeOrders, activity, links] = await Promise.all([
        supabase.from("scope_snapshots").select("*").eq("project_id", id!).order("version", { ascending: false }),
        supabase.from("scope_decisions").select("*").eq("project_id", id!),
        supabase.from("revision_requests").select("*").eq("project_id", id!).order("created_at", { ascending: false }),
        supabase.from("change_orders").select("*").eq("project_id", id!).order("number", { ascending: false }),
        supabase.from("activity_log").select("*").eq("project_id", id!).order("created_at", { ascending: false }).limit(60),
        supabase
          .from("share_links")
          .select("id, project_id, created_at, expires_at, revoked_at")
          .eq("project_id", id!)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
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
      };
    },
  });
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
