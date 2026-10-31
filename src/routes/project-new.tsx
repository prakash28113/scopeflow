import { useSearchParams } from "react-router";
import { Alert, PageHeader } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProfile } from "@/lib/auth";
import { ProjectForm, type FormValues } from "./project-form";

export default function NewProject() {
  const profile = useProfile();
  const [params] = useSearchParams();
  const welcome = params.get("welcome");
  if (!profile.data) return <PageSpinner />;
  const initial: FormValues = {
    title: "",
    summary: "",
    currency: profile.data.default_currency as FormValues["currency"],
    budget: "",
    startDate: "",
    dueDate: "",
    client: { name: "", email: "", company: "" },
    deliverables: [{ title: "", description: "", revisions: 2 }],
    milestones: [],
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
      <ProjectForm projectId={null} initial={initial} />
    </div>
  );
}
