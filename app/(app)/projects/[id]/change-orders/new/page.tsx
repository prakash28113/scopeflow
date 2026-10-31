import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/supabase/server";
import { currentDueDate } from "@/lib/pricing";
import type { Project, RevisionRequest } from "@/lib/types";
import { ChangeOrderForm } from "./change-order-form";

export const metadata: Metadata = { title: "New change order" };

export default async function NewChangeOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ request?: string }>;
}) {
  const { id } = await params;
  const { request: requestId } = await searchParams;
  const { supabase } = await requireUser();

  const { data } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as Project;
  if (p.status !== "active") redirect(`/projects/${id}`);

  let request: { id: string; description: string; label: string } | null = null;
  if (requestId && /^[0-9a-f-]{36}$/i.test(requestId)) {
    const { data: r } = await supabase
      .from("revision_requests")
      .select("*, deliverables(title)")
      .eq("id", requestId)
      .eq("project_id", id)
      .eq("status", "open")
      .maybeSingle();
    if (r) {
      const rr = r as RevisionRequest & { deliverables: { title: string } | null };
      request = {
        id: rr.id,
        description: rr.description,
        label: rr.kind === "revision" ? `Extra revision · ${rr.deliverables?.title ?? ""}` : `New work from ${rr.requested_by}`,
      };
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <Link href={`/projects/${id}`} className="hover:text-ink">
            ← {p.title}
          </Link>
        }
        title="New change order"
        description="Price the additional work. Your client approves it from their project link before anything changes."
      />
      <ChangeOrderForm
        projectId={id}
        currency={p.currency}
        originalMinor={Number(p.budget_cents)}
        contractMinor={Number(p.budget_cents) + Number(p.approved_extras_cents)}
        currentDue={currentDueDate(p.due_date, p.extra_days)}
        request={request}
      />
    </div>
  );
}
