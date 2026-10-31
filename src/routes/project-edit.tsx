import { Link, Navigate, useParams } from "react-router";
import { Alert, PageHeader } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProject } from "@/lib/queries";
import { toInputAmount } from "@/lib/money";
import NotFound from "./not-found";
import { ProjectForm, type FormValues } from "./project-form";

export default function EditProject() {
  const { id } = useParams();
  const q = useProject(id);
  if (q.isLoading) return <PageSpinner />;
  if (q.isError) return <Alert>Couldn't load this project. Please refresh.</Alert>;
  if (!q.data) return <NotFound />;
  const p = q.data.project;
  if (p.status !== "draft" && p.status !== "changes_requested") return <Navigate to={`/projects/${p.id}`} replace />;
  const initial: FormValues = {
    title: p.title,
    summary: p.summary ?? "",
    currency: p.currency as FormValues["currency"],
    budget: toInputAmount(Number(p.budget_cents), p.currency),
    startDate: p.start_date ?? "",
    dueDate: p.due_date ?? "",
    client: { name: p.clients.name, email: p.clients.email, company: p.clients.company ?? "" },
    deliverables: p.deliverables.map((d) => ({ title: d.title, description: d.description ?? "", revisions: d.revisions_included })),
    milestones: p.milestones.map((m) => ({ title: m.title, amount: toInputAmount(Number(m.amount_cents), p.currency), dueDate: m.due_date ?? "" })),
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <Link to={`/projects/${p.id}`} className="hover:text-ink">
            ← {p.title}
          </Link>
        }
        title="Edit scope"
        description="Saving replaces the current draft. Your client sees the new version when you send it."
      />
      <ProjectForm projectId={p.id} initial={initial} />
    </div>
  );
}
