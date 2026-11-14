import { buttonClass, cx } from "./ui";
import { whatsAppHref } from "@/lib/client-message";
import { mailLink } from "@/lib/nudge";

/** "Tell the client": the ready message, opened in the freelancer's own WhatsApp or email. */
export function TellClient({ message, phone, email }: { message: { text: string; subject: string }; phone?: string | null; email?: string | null }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-canvas p-3" data-testid="tell-client">
      <p className="text-[12px] font-medium text-ink-2">Tell your client (ready to send, edit if you like)</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink" data-testid="tell-client-text">
        {message.text}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={whatsAppHref(phone, message.text)} target="_blank" rel="noopener" className={cx(buttonClass("secondary", "sm"), "min-h-10")} data-testid="tell-client-whatsapp">
          Send on WhatsApp
        </a>
        {email ? (
          <a href={mailLink(email, message.subject, message.text)} target="_blank" rel="noopener" className={cx(buttonClass("secondary", "sm"), "min-h-10")}>
            Email
          </a>
        ) : null}
      </div>
    </div>
  );
}
