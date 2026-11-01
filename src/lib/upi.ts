/** UPI deep links (NPCI "upi://pay" format) for paying a milestone from any UPI app. */
export const UPI_ID = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export function upiPayUrl(p: { upiId: string; payee: string; amountPaise: number; note: string }): string {
  const q = new URLSearchParams({
    pa: p.upiId,
    pn: p.payee.slice(0, 50),
    am: (p.amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: p.note.replace(/[^\p{L}\p{N} .,&()-]/gu, "").slice(0, 60),
  });
  return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
}
