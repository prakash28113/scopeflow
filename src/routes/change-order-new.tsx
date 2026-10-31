import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { Alert, PageHeader } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProject } from "@/lib/queries";
import { currentDueDate } from "@/lib/pricing";
import NotFound from "./not-found";
import { ChangeOrderForm } from "./change-order-form";

export default function NewChangeOrder() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const q = useProject(id);
  if (q.isLoading) return <PageSpinner />;
  if (q.isError) return <Alert>Couldn't load this project. Please refresh.</Alert>;
  if (!q.data) return <NotFound />;
  const p = q.data.project;
  if (p.status !== "active") return <Navigate to={`/projects/${p.id}`} replace />;

  const requestId = params.get("request");
  const rr = requestId ? q.data.revisions.find((r) => r.id === requestId && r.status === "open") : undefined;
  const request = rr
    ? {
        id: rr.id,
        description: rr.description,
        label: rr.kind === "revision" ? `Extra revision · ${p.deliverables.find((d) => d.id === rr.deliverable_id)?.title ?? ""}` : `New work from ${rr.requested_by}`,
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <Link to={`/projects/${p.id}`} className="hover:text-ink">
            ← {p.title}
          </Link>
        }
        title="New change order"
        description="Price the additional work. Your client approves it from their project link before anything changes."
      />
      <ChangeOrderForm
        projectId={p.id}
        currency={p.currency}
        originalMinor={Number(p.budget_cents)}
        contractMinor={Number(p.budget_cents) + Number(p.approved_extras_cents)}
        currentDue={currentDueDate(p.due_date, p.extra_days)}
        request={request}
      />
    </div>
  );
}
