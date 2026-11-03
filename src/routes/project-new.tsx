import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Alert, PageHeader } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProfile } from "@/lib/auth";
import { ProjectForm, emptyDeliverable, type FormValues } from "./project-form";
import { useMyPlan } from "@/lib/plans";
import { PlanLimitCard } from "@/components/plans";

export default function NewProject() {
  const profile = useProfile();
  const plan = useMyPlan();
  const [params] = useSearchParams();
  const welcome = params.get("welcome");
  const clientId = params.get("client");
  const client = useQuery({
    queryKey: ["client-prefill", clientId],
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("name, email, company").eq("id", clientId!).maybeSingle();
      return data as { name: string; email: string; company: string | null } | null;
    },
  });
  if (!profile.data || plan.isLoading || (clientId && client.isLoading)) return <PageSpinner />;
  const m = plan.data;
  // Explain the limit before any typing; the database enforces it either way.
  const atLimit = m && m.limits.active_projects !== null && m.usage.active_projects >= m.limits.active_projects;
  const initial: FormValues = {
    title: "",
    summary: "",
    currency: profile.data.default_currency as FormValues["currency"],
    budget: "",
    startDate: "",
    dueDate: "",
    client: client.data ? { name: client.data.name, email: client.data.email, company: client.data.company ?? "" } : { name: "", email: "", company: "" },
    deliverables: [emptyDeliverable(2)],
    milestones: [],
    exclusions: "",
    terms: "",
    extraRevision: "",
    itemised: false,
    discount: "",
    tax: "",
    taxLabel: "",
    validUntil: "",
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={welcome ? "Step 2 of 2" : "Projects"}
        title="New project"
        description="Define the scope once. When your client approves it, it's locked in as the reference for every revision and change order."
      />
      {welcome ? (
        <div className="mb-6">
          <Alert tone="info">Your workspace is ready. Create your first project to get a private approval link for your client.</Alert>
        </div>
      ) : null}
      {atLimit && m ? (
        <PlanLimitCard
          limit={{
            kind: "active_projects",
            limit: m.limits.active_projects!,
            used: m.usage.active_projects,
            plan: m.effective_plan,
            message: `Your Free plan includes ${m.limits.active_projects} active projects (drafts and projects waiting for approval count), and you have ${m.usage.active_projects}. Complete or cancel a project, delete a draft, or see plans to get more.`,
          }}
        />
      ) : (
        <ProjectForm projectId={null} initial={initial} showTemplates />
      )}
    </div>
  );
}
