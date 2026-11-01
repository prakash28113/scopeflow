import { useEffect, useRef } from "react";
import { Button, buttonClass } from "./ui";
import { CopyButton } from "./form-bits";
import { formatDate } from "@/lib/format";

/**
 * Shows a freshly generated client link. The database keeps only a hash, so
 * this is the one and only time the full link can be displayed.
 */
export function ShareLinkDialog({
  link,
  clientName,
  clientEmail,
  projectTitle,
  onClose,
}: {
  link: { url: string; expiresAt: string } | null;
  clientName: string;
  clientEmail?: string;
  projectTitle: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (link && !d.open) d.showModal();
    if (!link && d.open) d.close();
  }, [link]);

  const message = link
    ? `Hi ${clientName}, here's the project page for “${projectTitle}”. You can review and approve the scope here — no account needed:\n${link.url}`
    : "";
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="share-title"
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
    >
      {link ? (
        <div className="p-5 sm:p-6">
          <h2 id="share-title" className="text-[17px] font-semibold tracking-[-0.01em]">
            Client link ready
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Copy it now — for security it's stored only as a fingerprint and can't be shown again. If it's lost, create a new one.
          </p>
          <div className="mt-4 rounded-lg border border-line bg-sunken p-3">
            <p className="break-all font-mono text-[12px] leading-relaxed text-ink-2" data-testid="share-url">
              {link.url}
            </p>
          </div>
          <p className="mt-2 text-[12px] text-muted">Works until {formatDate(link.expiresAt)}. Anyone with the link can view and respond.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <CopyButton value={link.url} label="Copy link" size="md" variant="primary" />
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClass("secondary")}
              data-testid="share-whatsapp"
            >
              Send on WhatsApp
            </a>
            {clientEmail ? (
              <a
                href={`mailto:${encodeURIComponent(clientEmail)}?subject=${encodeURIComponent(`Scope for ${projectTitle}`)}&body=${encodeURIComponent(message)}`}
                className={buttonClass("secondary")}
              >
                Email
              </a>
            ) : null}
            <CopyButton value={message} label="Copy with message" size="md" />
            <a href={link.url} target="_blank" rel="noreferrer noopener" className={buttonClass("ghost")}>
              Open
            </a>
            {canShare ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.share({ title: projectTitle, text: message }).catch(() => {})}
              >
                Share…
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => ref.current?.close()}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
