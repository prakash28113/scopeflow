import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Textarea, buttonClass, cx } from "./ui";
import { useToast } from "./toast";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/auth";
import { localToday } from "@/lib/upcoming";
import { buildNudge, isOverdue, mailLink, waLink, type NudgeTone } from "@/lib/nudge";

/** What the nudge needs to know about an invoice. balanceCents is what's still owed. */
export type NudgeInvoice = { id: string; number: string; due_date: string; currency: string; balanceCents: number };
type Contact = { id: string; name: string; email: string | null; phone: string | null };

const BellIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.7-5A8.5 8.5 0 1 1 21 12Z" />
    <path d="M8.5 11h7M8.5 14.5h4.5" />
  </svg>
);

/** Records the nudge without holding up the hand-off to WhatsApp or the mail app. */
export function recordNudge(invoiceId: string, channel: "whatsapp" | "email", tone: NudgeTone, rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> = (fn, args) => supabase.rpc(fn, args)): Promise<boolean> {
  return Promise.resolve(rpc("record_nudge", { p_invoice_id: invoiceId, p: { channel, tone } })).then(
    (r) => !r.error,
    () => false,
  );
}

/**
 * "Nudge": opens a small sheet with a ready message about an unpaid invoice. The two buttons are
 * plain links to wa.me and mailto:, so the freelancer's own app sends it. ScopeFlow sends nothing
 * and the message never contains a link.
 */
export function NudgeButton({ invoice, compact = false, className }: { invoice: NudgeInvoice; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="nudge-button"
        aria-label={compact ? `Nudge client about ${invoice.number}` : undefined}
        title={compact ? "Nudge client" : undefined}
        className={cx(compact ? "grid size-11 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink sm:size-9" : buttonClass("secondary"), className)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {compact ? BellIcon : "Nudge"}
      </button>
      {open ? <NudgeSheet invoice={invoice} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NudgeSheet({ invoice, onClose }: { invoice: NudgeInvoice; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const toast = useToast();
  const qc = useQueryClient();
  const profile = useProfile();
  const today = localToday();
  const overdue = isOverdue(invoice.due_date, today);
  const [tone, setTone] = useState<NudgeTone>("gentle");
  const [text, setText] = useState<string | null>(null); // null until the person edits it

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const contact = useQuery({
    queryKey: ["nudge-contact", invoice.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("client_invoices").select("id, projects(clients(id, name, email, phone))").eq("id", invoice.id).single();
      if (error) throw error;
      return ((data as unknown as { projects: { clients: Contact | null } | null }).projects?.clients ?? null) as Contact | null;
    },
  });
  const client = contact.data;
  const built = buildNudge({
    tone,
    clientName: client?.name ?? "",
    invoiceNumber: invoice.number,
    balanceCents: invoice.balanceCents,
    currency: invoice.currency,
    dueDate: invoice.due_date,
    today,
    upiId: profile.data?.upi_id,
    businessName: profile.data?.business_name || profile.data?.full_name,
  });
  const message = text ?? built.text;
  const wa = client ? waLink(client.phone, message) : null;
  const mail = client?.email ? mailLink(client.email, built.subject, message) : null;

  function sent(channel: "whatsapp" | "email") {
    // Fire and forget: the link opens the other app straight away.
    void recordNudge(invoice.id, channel, tone).then((ok) => {
      if (!ok) return;
      toast("positive", "Nudge recorded. We'll remind you to check in 3 days.");
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    });
    onClose();
  }

  const action = cx(buttonClass("primary"), "min-h-11 w-full justify-center sm:w-auto");
  return (
    <dialog
      ref={ref}
      aria-labelledby={title}
      data-testid="nudge-sheet"
      className="sf-dialog m-auto w-[calc(100%-24px)] max-w-md rounded-[14px] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="space-y-4 p-5">
        <div>
          <h2 id={title} className="text-[16px] font-semibold">
            Nudge about {invoice.number}
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">Sent from your own WhatsApp or email. ScopeFlow sends nothing to your client.</p>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Tone</legend>
          <div className="flex gap-2">
            {(["gentle", "firm"] as const).map((t) => {
              const disabled = t === "firm" && !overdue;
              return (
                <label key={t} className={cx("flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium", tone === t ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-ink-2", disabled && "cursor-not-allowed opacity-50")}>
                  <input
                    type="radio"
                    name={`${title}-tone`}
                    value={t}
                    checked={tone === t}
                    disabled={disabled}
                    className="accent-[var(--color-accent)]"
                    onChange={() => {
                      setTone(t);
                      setText(null); // a new tone starts from its own wording
                    }}
                  />
                  {t === "gentle" ? "Gentle" : "Firm"}
                </label>
              );
            })}
          </div>
          {!overdue ? <p className="mt-1.5 text-[12px] text-ink-2">Firm is for invoices past their due date.</p> : null}
        </fieldset>
        <div>
          <label htmlFor={`${title}-msg`} className="mb-1.5 block text-[13px] font-medium">
            Message
          </label>
          <Textarea id={`${title}-msg`} rows={6} value={message} onChange={(e) => setText(e.target.value)} data-testid="nudge-message" />
        </div>
        {contact.isError ? <p className="text-[13px] text-danger">Couldn't load the client's details. Close this and try again.</p> : null}
        {client && !wa ? (
          <p className="text-[13px] text-ink-2" data-testid="nudge-no-phone">
            <Link to={`/clients/${client.id}`} className="font-medium text-accent hover:underline">
              Add the client's phone to nudge on WhatsApp
            </Link>
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 border-t border-line bg-canvas/60 px-5 py-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>
          Cancel
        </Button>
        {mail ? (
          <a href={mail} target="_blank" rel="noopener" className={wa ? cx(buttonClass("secondary"), "min-h-11 w-full justify-center sm:w-auto") : action} data-testid="nudge-email" onClick={() => sent("email")}>
            Open email
          </a>
        ) : null}
        {wa ? (
          <a href={wa} target="_blank" rel="noopener" className={action} data-testid="nudge-whatsapp" onClick={() => sent("whatsapp")}>
            Open WhatsApp
          </a>
        ) : null}
      </div>
    </dialog>
  );
}
