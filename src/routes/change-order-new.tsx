import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { Alert, PageHeader } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProject } from "@/lib/queries";
import { currentDueDate } from "@/lib/pricing";
import { toInputAmount } from "@/lib/money";
import NotFound from "./not-found";
import { ChangeOrderForm } from "./change-order-form";

export default function NewChangeOrder() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const q = useProject(id);
  const ai = aiDraftFrom(useLocation().state);
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
  // An extra revision round has an agreed price in the approved scope: start from it.
  const suggestedAmount = ai?.amount
    ? ai.amount
    : rr?.kind === "revision" && p.extra_revision_cents !== null && p.extra_revision_cents !== undefined
      ? toInputAmount(Number(p.extra_revision_cents), p.currency)
      : "";

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
        suggestedAmount={suggestedAmount}
        taxBps={p.tax_bps ?? 0}
        taxLabel={p.tax_label ?? null}
        suggestedTitle={ai?.title || (rr ? (rr.kind === "revision" ? "Extra revision round" : rr.description.split(/[.\n]/)[0].slice(0, 80)) : "")}
        suggestedDescription={ai?.description || undefined}
      />
      {ai ? <p className="mt-3 text-[12px] text-muted">Filled in from the scope check. Check the price and details before you send it.</p> : null}
    </div>
  );
}

/** A change-order suggestion passed from the scope check (navigation state is untrusted input). */
function aiDraftFrom(state: unknown): { title: string; description: string; amount: string } | null {
  const d = (state as { aiDraft?: Record<string, unknown> } | null)?.aiDraft;
  if (!d || typeof d !== "object") return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const amount = str(d.amount, 20);
  return { title: str(d.title, 160), description: str(d.description, 2000), amount: /^\d+(\.\d{1,2})?$/.test(amount) ? amount : "" };
}
