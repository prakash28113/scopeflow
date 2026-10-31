import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/supabase/server";
import { toInputAmount } from "@/lib/money";
import type { Client, Deliverable, Milestone, Project } from "@/lib/types";
import { ProjectForm } from "../../project-form";

export const metadata: Metadata = { title: "Edit scope" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("projects")
    .select("*, clients(*), deliverables(*), milestones(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const p = data as Project & { clients: Client; deliverables: Deliverable[]; milestones: Milestone[] };
  if (p.status !== "draft" && p.status !== "changes_requested") redirect(`/projects/${id}`);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={<Link href={`/projects/${id}`} className="hover:text-ink">← {p.title}</Link>}
        title="Edit scope"
        description="Saving replaces the current draft. Your client sees the new version when you send it."
      />
      <ProjectForm
        projectId={id}
        initial={{
          title: p.title,
          summary: p.summary ?? "",
          currency: p.currency as never,
          budget: toInputAmount(Number(p.budget_cents), p.currency),
          startDate: p.start_date ?? "",
          dueDate: p.due_date ?? "",
          client: { name: p.clients.name, email: p.clients.email, company: p.clients.company ?? "" },
          deliverables: [...p.deliverables]
            .sort((a, b) => a.position - b.position)
            .map((d) => ({ title: d.title, description: d.description ?? "", revisions: d.revisions_included })),
          milestones: [...p.milestones]
            .sort((a, b) => a.position - b.position)
            .map((m) => ({ title: m.title, amount: toInputAmount(Number(m.amount_cents), p.currency), dueDate: m.due_date ?? "" })),
        }}
      />
    </div>
  );
}
