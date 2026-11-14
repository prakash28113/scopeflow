/**
 * Ready words for the awkward moment: telling a client that something is an extra. The freelancer
 * sends them from their own WhatsApp or email; ScopeFlow sends nothing, and the text carries no
 * link (the client already has their private project link).
 */
import { formatMoney } from "./money";
import { waNumber } from "./nudge";

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const firstName = (name: string) => clean(name).split(" ")[0] || "there";

export function changeOrderMessage(i: {
  clientName: string;
  number: number;
  title: string;
  amountCents: number;
  currency: string;
  additionalDays?: number | null;
  businessName?: string | null;
}): { text: string; subject: string } {
  const amount = formatMoney(i.amountCents, i.currency);
  const days = i.additionalDays ? `, +${i.additionalDays} day${i.additionalDays === 1 ? "" : "s"}` : "";
  const title = clean(i.title);
  const sign = clean(i.businessName);
  const text =
    `Hi ${firstName(i.clientName)}, I've added change order #${i.number} for “${title}” on your project page: ${amount}${days}. ` +
    `It's outside the scope you approved, so nothing changes until you approve it there. ${sign ? `Thank you! – ${sign}` : "Thank you!"}`;
  return { text, subject: `Change order #${i.number}: ${title} (${amount})` };
}

/** WhatsApp straight to the client's chat when their number is known; otherwise WhatsApp asks who to send to. */
export function whatsAppHref(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}

/** Where the client page's "Made with ScopeFlow" goes; the tags show up in sign-up sources. */
export const PORTAL_REFERRAL_URL = "/?utm_source=client-link&utm_medium=portal";
