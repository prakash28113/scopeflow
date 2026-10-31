import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/supabase/server";
import { ProjectForm } from "../project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { profile } = await requireUser();
  const { welcome } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={welcome ? "Step 2 of 2" : "Projects"}
        title="New project"
        description="Define the scope once. When your client approves it, it's locked in as the reference for every revision and change order."
      />
      {welcome ? (
        <div className="mb-6">
          <Alert tone="info">Your workspace is ready. Create your first project to get a shareable approval link.</Alert>
        </div>
      ) : null}
      <ProjectForm
        projectId={null}
        initial={{
          title: "",
          summary: "",
          currency: profile.default_currency as never,
          budget: "",
          startDate: "",
          dueDate: "",
          client: { name: "", email: "", company: "" },
          deliverables: [{ title: "", description: "", revisions: 2 }],
          milestones: [],
        }}
      />
    </div>
  );
}
