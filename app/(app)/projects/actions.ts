"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { userMessage } from "@/lib/errors";
import { setFlash } from "@/lib/flash";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/money";
import { ensureShareUrl, getActiveShareUrl, rotateShareLink } from "@/lib/share-links";
import {
  changeOrderSchema,
  issuesToFieldErrors,
  projectFormSchema,
  toProjectPayload,
  type ActionState,
} from "@/lib/validation";

const uuid = z.uuid();

function assertId(id: string) {
  if (!uuid.safeParse(id).success) throw new Error("Invalid id");
  return id;
}

function senderName(p: { business_name: string | null; full_name: string | null; email: string }) {
  return p.business_name || p.full_name || p.email;
}

async function back(projectId: string, tone: "positive" | "danger" | "info", message: string): Promise<never> {
  await setFlash({ tone, message });
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

// ------------------------------------------------------------------ create / edit
export async function saveProject(projectId: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  if (projectId) assertId(projectId);

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return { error: "The form could not be read. Please try again." };
  }
  const parsed = projectFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  }

  const { data, error } = await supabase.rpc("save_project", {
    p_project_id: projectId,
    p: toProjectPayload(parsed.data),
  });
  if (error) return { error: userMessage(error) };

  const id = data as string;
  await setFlash({ tone: "positive", message: projectId ? "Scope updated." : "Project created. Review it, then send it to your client." });
  revalidatePath("/dashboard");
  redirect(`/projects/${id}`);
}

export async function deleteDraft(projectId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_draft_project", { p_project_id: assertId(projectId) });
  if (error) return back(projectId, "danger", userMessage(error));
  await setFlash({ tone: "info", message: "Draft deleted." });
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// ------------------------------------------------------------------ scope approval
export async function sendScope(projectId: string) {
  const { supabase, profile } = await requireUser();
  assertId(projectId);

  const link = await ensureShareUrl(supabase, projectId);
  if (link.error || !link.url) return back(projectId, "danger", userMessage(link.error, "Could not create the client link."));

  const { data, error } = await supabase.rpc("send_scope", { p_project_id: projectId });
  if (error) return back(projectId, "danger", userMessage(error));

  const { data: project } = await supabase
    .from("projects")
    .select("title, owner_id, clients(name, email)")
    .eq("id", projectId)
    .single();
  const client = project?.clients as unknown as { name: string; email: string } | null;
  const version = (data as { version: number }).version;

  let note = "";
  if (project && client) {
    const status = await sendEmail({
      to: client.email,
      template: "scope_sent",
      ownerId: project.owner_id,
      projectId,
      content: {
        subject: `${senderName(profile)} sent you a project scope to review`,
        heading: `Please review the scope for “${project.title}”`,
        paragraphs: [
          `Hi ${client.name},`,
          `${senderName(profile)} has shared ${version > 1 ? `an updated scope (version ${version})` : "the project scope"} for your approval. It lists the deliverables, revisions included, budget and payment schedule.`,
          "You can approve it or ask for changes — no account needed.",
        ],
        cta: { label: "Review scope", url: link.url },
      },
    });
    note =
      status === "sent"
        ? ` We emailed ${client.email}.`
        : status === "skipped"
          ? " Email isn't configured, so copy the client link below and send it yourself."
          : " The email could not be delivered — copy the client link below and send it yourself.";
  }
  return back(projectId, "positive", `Scope v${version} sent for approval.${note}`);
}

export async function recallScope(projectId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("recall_scope", { p_project_id: assertId(projectId) });
  if (error) return back(projectId, "danger", userMessage(error));
  return back(projectId, "info", "Scope recalled. Edit it and send it again when ready.");
}

export async function rotateLink(projectId: string) {
  const { supabase } = await requireUser();
  const res = await rotateShareLink(supabase, assertId(projectId));
  if (res.error) return back(projectId, "danger", userMessage(res.error));
  return back(projectId, "positive", "New client link created. The old link no longer works.");
}

export async function revokeLink(projectId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("revoke_share_link", { p_project_id: assertId(projectId) });
  if (error) return back(projectId, "danger", userMessage(error));
  return back(projectId, "info", "Client link revoked.");
}

export async function completeProject(projectId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("complete_project", { p_project_id: assertId(projectId) });
  if (error) return back(projectId, "danger", userMessage(error));
  return back(projectId, "positive", "Project marked as completed.");
}

export async function cancelProject(projectId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("cancel_project", { p_project_id: assertId(projectId) });
  if (error) return back(projectId, "danger", userMessage(error));
  return back(projectId, "info", "Project cancelled. Pending change orders were withdrawn.");
}

// ------------------------------------------------------------------ revisions
export async function resolveRevision(projectId: string, revisionId: string, form: FormData) {
  const { supabase } = await requireUser();
  const note = String(form.get("note") ?? "").slice(0, 2000);
  const { error } = await supabase.rpc("resolve_revision", { p_revision_id: assertId(revisionId), p_note: note });
  if (error) return back(assertId(projectId), "danger", userMessage(error));
  return back(projectId, "positive", "Request marked as done.");
}

// ------------------------------------------------------------------ change orders
export async function createChangeOrder(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireUser();
  assertId(projectId);

  const { data: project } = await supabase
    .from("projects")
    .select("title, currency, owner_id, clients(name, email)")
    .eq("id", projectId)
    .single();
  if (!project) return { error: "Project not found." };

  const parsed = changeOrderSchema(project.currency).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };

  const { data: coId, error } = await supabase.rpc("create_change_order", { p_project_id: projectId, p: parsed.data });
  if (error) return { error: userMessage(error) };

  const { data: co } = await supabase
    .from("change_orders")
    .select("number, title, amount_cents, additional_days")
    .eq("id", coId as string)
    .single();
  const client = project.clients as unknown as { name: string; email: string } | null;
  const url = await getActiveShareUrl(supabase, projectId);

  let note = "";
  if (co && client && url) {
    const status = await sendEmail({
      to: client.email,
      template: "change_order_sent",
      ownerId: project.owner_id,
      projectId,
      content: {
        subject: `Change order #${co.number} for ${project.title}`,
        heading: `A change order needs your approval`,
        paragraphs: [
          `Hi ${client.name},`,
          `${senderName(profile)} proposed change order #${co.number}: “${co.title}”.`,
          `Additional cost: ${formatMoney(Number(co.amount_cents), project.currency)}${co.additional_days ? ` · Additional time: ${co.additional_days} day${co.additional_days === 1 ? "" : "s"}` : ""}.`,
          "Nothing changes until you approve it.",
        ],
        cta: { label: "Review change order", url },
      },
    });
    note = status === "sent" ? ` We emailed ${client.email}.` : " Email isn't delivered — share the client link yourself.";
  } else if (!url) {
    note = " There is no active client link — create one so your client can respond.";
  }

  await setFlash({ tone: "positive", message: `Change order sent for approval.${note}` });
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

export async function withdrawChangeOrder(projectId: string, changeOrderId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("withdraw_change_order", { p_change_order_id: assertId(changeOrderId) });
  if (error) return back(assertId(projectId), "danger", userMessage(error));
  return back(projectId, "info", "Change order withdrawn.");
}

export async function completeChangeOrderWork(projectId: string, changeOrderId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("complete_change_order_work", { p_change_order_id: assertId(changeOrderId) });
  if (error) return back(assertId(projectId), "danger", userMessage(error));
  return back(projectId, "positive", "Additional work marked as delivered.");
}

// ------------------------------------------------------------------ payments
export async function setMilestonePaid(projectId: string, milestoneId: string, paid: boolean, form: FormData) {
  const { supabase } = await requireUser();
  const note = String(form.get("note") ?? "").slice(0, 500);
  const { error } = await supabase.rpc("set_milestone_paid", {
    p_milestone_id: assertId(milestoneId),
    p_paid: paid,
    p_note: note,
  });
  if (error) return back(assertId(projectId), "danger", userMessage(error));
  return back(projectId, "positive", paid ? "Payment recorded." : "Payment mark removed.");
}
