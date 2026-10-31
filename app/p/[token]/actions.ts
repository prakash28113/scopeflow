"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient, createPublicClient } from "@/lib/supabase/server";
import { userMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { isPlausibleToken } from "@/lib/tokens";
import {
  changeOrderDecisionSchema,
  issuesToFieldErrors,
  revisionRequestSchema,
  scopeDecisionSchema,
  type ActionState,
} from "@/lib/validation";

async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ua: h.get("user-agent")?.slice(0, 500) ?? null, ip: ip?.slice(0, 64) ?? null };
}

/** Looks up the freelancer's email with the service role, after the token-gated RPC succeeded. */
async function notifyOwner(ownerId: string, projectId: string, template: string, subject: string, paragraphs: string[]) {
  try {
    const { data } = await createAdminClient().from("profiles").select("email").eq("id", ownerId).single();
    if (!data?.email) return;
    await sendEmail({
      to: data.email,
      template,
      ownerId,
      projectId,
      content: {
        subject,
        heading: subject,
        paragraphs,
        cta: { label: "Open project", url: `${env.appUrl()}/projects/${projectId}` },
      },
    });
  } catch (e) {
    console.error("[scopeflow] owner notification failed", e);
  }
}

export async function decideScope(token: string, _: ActionState, form: FormData): Promise<ActionState> {
  if (!isPlausibleToken(token)) return { error: "This link is invalid." };
  const parsed = scopeDecisionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };
  const meta = await requestMeta();

  const { data, error } = await createPublicClient().rpc("portal_decide_scope", {
    p_token: token,
    p_snapshot_id: parsed.data.snapshotId,
    p_decision: parsed.data.decision,
    p_client_name: parsed.data.clientName,
    p_comment: parsed.data.comment,
    p_user_agent: meta.ua,
    p_ip: meta.ip,
  });
  if (error) return { error: userMessage(error) };

  const r = data as { project_id: string; owner_id: string; title: string; version: number; client_name: string; comment: string | null };
  const approved = parsed.data.decision === "approved";
  await notifyOwner(
    r.owner_id,
    r.project_id,
    approved ? "scope_approved" : "scope_rejected",
    approved ? `${r.client_name} approved the scope for ${r.title}` : `${r.client_name} requested changes to ${r.title}`,
    approved
      ? [`Version ${r.version} of the scope is approved and locked. The project is now in progress.`]
      : [`Feedback on version ${r.version}:`, `“${r.comment ?? ""}”`, "Edit the scope and send the revised version from ScopeFlow."],
  );
  revalidatePath(`/p/${token}`);
  return { ok: true, message: approved ? "Thanks — the scope is approved." : "Thanks — your feedback was sent." };
}

export async function requestRevision(token: string, _: ActionState, form: FormData): Promise<ActionState> {
  if (!isPlausibleToken(token)) return { error: "This link is invalid." };
  const parsed = revisionRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };

  const { data, error } = await createPublicClient().rpc("portal_request_revision", {
    p_token: token,
    p_kind: parsed.data.kind,
    p_deliverable_id: parsed.data.kind === "revision" ? parsed.data.deliverableId : null,
    p_description: parsed.data.description,
    p_client_name: parsed.data.clientName,
  });
  if (error) return { error: userMessage(error) };

  const r = data as {
    project_id: string; owner_id: string; title: string; in_scope: boolean; summary: string; client_name: string;
  };
  await notifyOwner(
    r.owner_id,
    r.project_id,
    "revision_requested",
    r.in_scope ? `New revision request on ${r.title}` : `Out-of-scope request on ${r.title}`,
    [r.summary, `“${parsed.data.description}”`, `— ${r.client_name}`],
  );
  revalidatePath(`/p/${token}`);
  return {
    ok: true,
    message: r.in_scope
      ? "Request sent. It's covered by the revisions included in your scope."
      : "Request sent. It goes beyond the agreed scope, so your freelancer may propose a change order with a price before starting.",
  };
}

export async function decideChangeOrder(token: string, _: ActionState, form: FormData): Promise<ActionState> {
  if (!isPlausibleToken(token)) return { error: "This link is invalid." };
  const parsed = changeOrderDecisionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error) };
  const meta = await requestMeta();

  const { data, error } = await createPublicClient().rpc("portal_decide_change_order", {
    p_token: token,
    p_change_order_id: parsed.data.changeOrderId,
    p_decision: parsed.data.decision,
    p_client_name: parsed.data.clientName,
    p_comment: parsed.data.comment,
    p_user_agent: meta.ua,
    p_ip: meta.ip,
  });
  if (error) return { error: userMessage(error) };

  const r = data as { project_id: string; owner_id: string; title: string; number: number; change_order_title: string; client_name: string; comment: string | null };
  const approved = parsed.data.decision === "approved";
  await notifyOwner(
    r.owner_id,
    r.project_id,
    approved ? "change_order_approved" : "change_order_rejected",
    `${r.client_name} ${approved ? "approved" : "declined"} change order #${r.number}`,
    [
      `${r.title} — “${r.change_order_title}”.`,
      ...(r.comment ? [`Comment: “${r.comment}”`] : []),
      approved ? "The budget, timeline and payment milestones have been updated." : "Nothing on the project has changed.",
    ],
  );
  revalidatePath(`/p/${token}`);
  return { ok: true, message: approved ? "Change order approved." : "Change order declined." };
}
