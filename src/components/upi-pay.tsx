import { useState } from "react";
import qrcode from "qrcode-generator";
import { CopyButton } from "./form-bits";
import { upiPayUrl } from "@/lib/upi";

/** "Pay via UPI" for one milestone: opens a UPI app on phones; QR code for desktop. */
export function UpiPay({ upiId, payee, amountPaise, note }: { upiId: string; payee: string; amountPaise: number; note: string }) {
  const [qr, setQr] = useState(false);
  const url = upiPayUrl({ upiId, payee, amountPaise, note });
  const svg = qr
    ? (() => {
        const code = qrcode(0, "M");
        code.addData(url);
        code.make();
        return code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      })()
    : "";
  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <a href={url} className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-on-accent hover:bg-accent-hover" data-testid="upi-pay">
          Pay via UPI
        </a>
        <button type="button" onClick={() => setQr((v) => !v)} className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-accent ring-1 ring-accent-line hover:bg-accent-soft">
          {qr ? "Hide QR code" : "Show QR code"}
        </button>
        <CopyButton value={upiId} label="Copy UPI ID" size="sm" />
      </div>
      {qr ? (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {/* Generated locally from the payment link; no external service. */}
          <div className="size-40 rounded-lg bg-white p-1 ring-1 ring-line" aria-label={`QR code to pay ${payee} by UPI`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="max-w-[16rem] text-[12px] text-muted">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM). After paying, let {payee} know so they can mark it as received.</p>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted">Opens your UPI app with the amount filled in. ScopeFlow doesn't handle the payment.</p>
      )}
    </div>
  );
}
