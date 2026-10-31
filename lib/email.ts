import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";

export type EmailStatus = "sent" | "skipped" | "failed";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Template = {
  subject: string;
  heading: string;
  /** Plain paragraphs; escaped before rendering. */
  paragraphs: string[];
  cta?: { label: string; url: string };
};

export function renderEmail(t: Template): { html: string; text: string } {
  const body = t.paragraphs
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#3b3f46">${escapeHtml(p)}</p>`)
    .join("");
  const cta = t.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(t.cta.url)}" style="background:#3F6FD1;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(t.cta.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border:1px solid #e6e6e2;border-radius:12px"><tr><td style="padding:32px">
<p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:.02em;color:#3F6FD1">ScopeFlow</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#16181d">${escapeHtml(t.heading)}</h1>
${body}${cta}
</td></tr></table>
<p style="font-size:12px;color:#8a8d93;margin:16px 0 0">Sent by ScopeFlow on behalf of your project partner.</p>
</td></tr></table></body></html>`;
  const text = [t.heading, "", ...t.paragraphs, ...(t.cta ? ["", `${t.cta.label}: ${t.cta.url}`] : [])].join("\n");
  return { html, text };
}

/**
 * Sends via Resend's REST API. Never throws: a failed notification must not
 * undo a recorded approval. Every attempt is written to email_log so the
 * freelancer can see exactly what was (or wasn't) delivered.
 */
export async function sendEmail(args: {
  to: string;
  template: string;
  ownerId: string;
  projectId?: string;
  content: Template;
}): Promise<EmailStatus> {
  const { html, text } = renderEmail(args.content);
  const apiKey = env.resendApiKey();
  let status: EmailStatus = "skipped";
  let providerId: string | null = null;
  let error: string | null = apiKey ? null : "RESEND_API_KEY not configured";

  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.emailFrom(), to: [args.to], subject: args.content.subject, html, text }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok) {
        status = "sent";
        providerId = body.id ?? null;
      } else {
        status = "failed";
        error = `${res.status}: ${body.message ?? "Resend rejected the request"}`.slice(0, 500);
      }
    } catch (e) {
      status = "failed";
      error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    }
  }

  try {
    await createAdminClient().from("email_log").insert({
      owner_id: args.ownerId,
      project_id: args.projectId ?? null,
      recipient: args.to,
      template: args.template,
      status,
      provider_message_id: providerId,
      error,
    });
  } catch (e) {
    console.error("[scopeflow] could not write email_log", e);
  }
  if (status === "failed") console.error("[scopeflow] email failed", args.template, error);
  return status;
}
