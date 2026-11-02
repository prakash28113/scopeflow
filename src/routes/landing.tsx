import "@fontsource-variable/bricolage-grotesque/opsz.css";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { Figure, Figures, Meter, StatusBadge, buttonClass, cx } from "@/components/ui";
import { LogoFull } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

/**
 * Home page. The idea: every client job gets one record, like a ruled account book (khata):
 * blue ink on ruled paper, a red margin mark where something steps outside the agreement.
 * One moment of motion: the hero ledger writes itself in, in the order a real job happens.
 * Everything shown exists in the product today; example data is fictional; no invented customers or numbers.
 */
export default function Landing() {
  return (
    <div className="landing min-h-dvh bg-[var(--lp-paper)] text-[var(--lp-ink)]">
      <Nav />
      <main>
        <Hero />
        <Steps />
        <Workspace />
        <ClientSide />
        <Safe />
        <Questions />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}

/** The app's own buttons (design system), one size up for the home page. */
const btnPrimary = cx(buttonClass("primary"), "h-11 px-5 text-[15px] font-semibold");
const btnQuiet = cx(buttonClass("secondary"), "h-11 px-5 text-[15px] font-semibold");

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--lp-rule)] bg-[var(--lp-paper)]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="ScopeFlow home" className="inline-flex items-center">
          <LogoFull className="h-7 w-auto sm:h-8" />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          <a
            href="#how"
            className="hidden rounded-lg px-3 py-2 text-[14px] font-medium text-[var(--lp-body)] hover:bg-white hover:text-[var(--lp-ink)] md:block"
          >
            How it works
          </a>
          <Link
            to="/pricing"
            className="hidden rounded-lg px-3 py-2 text-[14px] font-medium text-[var(--lp-body)] hover:bg-white hover:text-[var(--lp-ink)] sm:block"
          >
            Pricing
          </Link>
          <Link
            to="/login"
            className="whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-medium text-[var(--lp-body)] hover:bg-white hover:text-[var(--lp-ink)]"
          >
            Sign in
          </Link>
          <Link to="/signup" className={buttonClass("primary", "sm")}>
            Start free
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- hero: the ledger

type Entry = { date: string; what: ReactNode; note?: string; amount?: string; mark?: "ok" | "out" | "paid" };
const LEDGER: Entry[] = [
  { date: "2 Nov", what: "Quote sent: 3 deliverables, GST included", note: "Valid until 16 Nov", amount: "₹45,000" },
  { date: "4 Nov", what: "Scope approved by Meera", note: "Locked, with a fingerprint", mark: "ok" },
  { date: "9 Nov", what: "“Can we try the logo in navy?”", note: "By WhatsApp, logged. Revision 2 of 2", mark: "ok" },
  { date: "11 Nov", what: "“Could you also do a website banner?”", note: "Outside the approved scope", mark: "out" },
  { date: "12 Nov", what: "Change order #1 approved", note: "Banner in 3 sizes, 2 extra days", amount: "+₹6,000" },
  { date: "15 Nov", what: "Invoice RS-2026-004, CGST + SGST", note: "50% advance", amount: "₹25,500" },
  { date: "16 Nov", what: "Paid by UPI", note: "UTR 4471 0938", amount: "₹25,500", mark: "paid" },
];

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--lp-rule)]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14 lg:pb-24 lg:pt-20">
        <div>
          <h1 className="lp-display text-[46px] leading-[0.98] sm:text-[68px] lg:text-[76px]">Every client job, on the record.</h1>
          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-[var(--lp-body)] sm:text-[19px]">
            Quote it, get it approved, check every “small change” against it, invoice with GST and see what you actually earned. One record
            per job, from the first quote to the last payment.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className={btnPrimary}>
              Start free
            </Link>
            <a href="#how" className={btnQuiet}>
              See how a job runs
            </a>
          </div>
          <p className="mt-4 max-w-[34rem] text-[13px] leading-relaxed text-[var(--lp-body)]">
            Free for 2 active projects, no card. Your clients never need an account. Made for designers, developers, editors and other
            independent creatives.
          </p>
        </div>
        <LedgerSheet />
      </div>
    </section>
  );
}

function Mark({ kind }: { kind: Entry["mark"] }) {
  if (!kind) return null;
  const label = kind === "out" ? "Outside scope" : kind === "paid" ? "Paid" : "Within scope";
  return (
    <span className={cx("lp-mark", `lp-mark-${kind}`)} title={label}>
      <span className="sr-only">{label}</span>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        {kind === "out" ? (
          <path d="M8 3.5v5.2M8 11.6v.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        ) : (
          <path
            d="M3.8 8.4 6.7 11.2 12.3 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  );
}

/** The record of one job, written in line by line (once; instantly with reduced motion). */
function LedgerSheet() {
  return (
    <figure
      className="lp-sheet relative"
      aria-label="Example record of one job: quote, approval, a request by WhatsApp, a request outside the scope, a change order, a GST invoice and a UPI payment, with profit so far"
    >
      <figcaption className="flex items-baseline justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
        <span>
          <span className="lp-display block text-[22px] leading-tight sm:text-[24px]">Brand kit</span>
          <span className="text-[13px] text-[var(--lp-body)]">Chai &amp; Co., for Raman Studio</span>
        </span>
        <span className="rounded-full bg-[var(--lp-blue-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--lp-blue)]">
          In progress
        </span>
      </figcaption>
      <ol className="lp-rows">
        {LEDGER.map((e, i) => (
          <li key={i} className={cx("lp-row", e.mark === "out" && "lp-row-out")} style={{ ["--i" as string]: i }}>
            <span className="lp-date tabular-nums">{e.date}</span>
            <span className="lp-margin">
              <Mark kind={e.mark} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium leading-snug">{e.what}</span>
              {e.note ? (
                <span
                  className={cx(
                    "block text-[12px] leading-snug",
                    e.mark === "out" ? "font-semibold text-[var(--lp-red)]" : "text-[var(--lp-body)]",
                  )}
                >
                  {e.note}
                </span>
              ) : null}
            </span>
            <span className={cx("lp-amt tabular-nums", e.mark === "paid" && "text-[var(--lp-green)]")}>{e.amount ?? ""}</span>
          </li>
        ))}
      </ol>
      <dl
        className="lp-total grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-4 text-[13px] tabular-nums sm:grid-cols-4 sm:px-6"
        style={{ ["--i" as string]: LEDGER.length }}
      >
        <div>
          <dt className="text-[var(--lp-body)]">Contract</dt>
          <dd className="font-semibold">₹51,000</dd>
        </div>
        <div>
          <dt className="text-[var(--lp-body)]">Received</dt>
          <dd className="font-semibold">₹25,500</dd>
        </div>
        <div>
          <dt className="text-[var(--lp-body)]">Expenses</dt>
          <dd className="font-semibold">−₹2,400</dd>
        </div>
        <div>
          <dt className="text-[var(--lp-body)]">Profit so far</dt>
          <dd className="font-semibold text-[var(--lp-green)]">₹23,100</dd>
        </div>
      </dl>
    </figure>
  );
}

// ---------------------------------------------------------------- the job, step by step

function Steps() {
  return (
    <section id="how" className="scroll-mt-16 border-b border-[var(--lp-rule)]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="max-w-2xl">
          <h2 className="lp-display text-[36px] leading-[1.02] sm:text-[52px]">How a job runs, start to finish.</h2>
          <p className="mt-5 text-[17px] leading-relaxed text-[var(--lp-body)]">
            Five steps, one record. Each step builds on the one before, so nobody has to remember what was agreed.
          </p>
        </div>
        <ol className="mt-14 border-t border-[var(--lp-rule-strong)]">
          <Step
            n={1}
            title="Quote the work"
            body="List the deliverables, how many revision rounds each gets, and what's not included. Price each line as a fixed fee, by the hour or per unit, add a discount and GST, and set how long the quote stays open."
            facts={[
              "Start from a template, or save your own",
              "Scope check flags vague words like “etc.” before you send",
              "Download the quote as a PDF",
            ]}
            visual={<QuoteVisual />}
          />
          <Step
            n={2}
            title="Get it approved"
            body="Share one private link on WhatsApp or by email. Your client reads the scope on their phone and approves it, or asks for changes. No account, no app."
            facts={["Each approved version is locked and fingerprinted", "Name, time and device are recorded with every approval"]}
            visual={<ApproveVisual />}
          />
          <Step
            n={3}
            title="Check every request against it"
            body="Requests from the client link are counted against the rounds they approved. When they ask on WhatsApp, on a call or by email, log it in a few taps and it's counted the same way."
            facts={[
              "Anything beyond the rounds, or outside the deliverables, is flagged",
              "Deliverable due dates, with reminders before they slip",
            ]}
            visual={<RequestVisual />}
          />
          <Step
            n={4}
            title="Price the extras"
            body="Turn an out-of-scope request into a change order: a fixed price or hours, plus any extra days. When your client approves it, the budget, due dates and payment schedule update by themselves."
            facts={["Your client approves before you start the extra work", "Every change stays in the project's history"]}
            visual={<ChangeOrderVisual />}
          />
          <Step
            n={5}
            title="Invoice and get paid"
            body="Create a GST tax invoice from any payment in a tap, with a UPI QR code your client can scan. Record full or part payments with the date and method, and see what's still owed."
            facts={[
              "CGST and SGST or IGST worked out for you",
              "One-tap PDF for you and your client",
              "ScopeFlow tracks payments. It never holds your money",
            ]}
            visual={<InvoiceVisual />}
            last
          />
        </ol>
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  body,
  facts,
  visual,
  last,
}: {
  n: number;
  title: string;
  body: string;
  facts: string[];
  visual: ReactNode;
  last?: boolean;
}) {
  return (
    <li
      className={cx(
        "lp-step grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-8 py-12 lg:grid-cols-[64px_1fr_1fr] lg:gap-10 lg:py-16",
        !last && "border-b border-[var(--lp-rule)]",
      )}
    >
      <span className="lp-display pt-0.5 text-[30px] leading-none text-[var(--lp-blue)] lg:text-[48px]" aria-hidden>
        {n}
      </span>
      <div className="max-w-[34rem]">
        <h3 className="lp-display text-[28px] leading-[1.08] sm:text-[34px]">{title}</h3>
        <p className="mt-4 text-[16px] leading-relaxed text-[var(--lp-body)] sm:text-[17px]">{body}</p>
        <ul className="mt-5 space-y-2.5">
          {facts.map((f) => (
            <li key={f} className="flex gap-3 text-[15px]">
              <svg width="18" height="18" viewBox="0 0 16 16" className="mt-[3px] shrink-0 text-[var(--lp-blue)]" aria-hidden>
                <path
                  d="M3.8 8.4 6.7 11.2 12.3 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {f}
            </li>
          ))}
        </ul>
      </div>
      <div className="col-span-2 min-w-0 lg:col-span-1">{visual}</div>
    </li>
  );
}

/** A slip of ruled paper that the step visuals sit on. */
function Slip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("lp-slip mx-auto w-full max-w-[400px] p-5", className)}>{children}</div>;
}

function QuoteVisual() {
  const lines: [string, string, string][] = [
    ["Social post designs", "10 posts × ₹500", "₹5,000"],
    ["Launch reel edit", "6 h × ₹1,200", "₹7,200"],
    ["Content calendar", "Fixed", "₹3,000"],
  ];
  return (
    <Slip>
      <p className="lp-display text-[20px]">Quote</p>
      <table className="mt-3 w-full text-[13px] tabular-nums">
        <caption className="sr-only">Example quote</caption>
        <tbody>
          {lines.map(([t, b, a]) => (
            <tr key={t} className="border-t border-[var(--lp-rule)] align-top">
              <td className="py-2 pr-3">
                {t}
                <span className="block text-[12px] text-[var(--lp-body)]">{b}</span>
              </td>
              <td className="py-2 text-right">{a}</td>
            </tr>
          ))}
          <tr className="border-t border-[var(--lp-rule)] text-[var(--lp-body)]">
            <td className="py-1.5">GST 18%</td>
            <td className="py-1.5 text-right">₹2,736</td>
          </tr>
          <tr className="border-t-2 border-[var(--lp-ink)] font-semibold">
            <td className="pt-2">Total</td>
            <td className="pt-2 text-right">₹17,936</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-[12px] text-[var(--lp-body)]">Quote valid until 16 Nov</p>
    </Slip>
  );
}

function ApproveVisual() {
  return (
    <div className="lp-phone mx-auto w-[260px]">
      <div className="rounded-[26px] bg-white p-4 pt-6">
        <p className="text-[11px] text-[var(--lp-body)]">Raman Studio sent you a scope to review</p>
        <p className="lp-display mt-1 text-[19px] leading-tight">Brand kit</p>
        <ul className="mt-3 space-y-2 text-[12px]">
          <li className="flex justify-between gap-2">
            <span>Logo and colours</span>
            <span className="text-[var(--lp-body)]">2 rounds</span>
          </li>
          <li className="flex justify-between gap-2">
            <span>Packaging label</span>
            <span className="text-[var(--lp-body)]">1 round</span>
          </li>
          <li className="flex justify-between gap-2 text-[var(--lp-body)]">
            <span>Not included</span>
            <span>Printing</span>
          </li>
        </ul>
        <p className="mt-3 flex justify-between border-t border-[var(--lp-rule)] pt-2 text-[12px] font-semibold tabular-nums">
          <span>Total</span>
          <span>₹45,000</span>
        </p>
        <div className="mt-3 rounded-full bg-[var(--lp-blue)] py-2 text-center text-[13px] font-semibold text-white">Approve scope</div>
        <div className="mt-2 rounded-full py-2 text-center text-[13px] font-semibold ring-1 ring-[var(--lp-rule-strong)]">
          Request changes
        </div>
      </div>
    </div>
  );
}

function RequestVisual() {
  return (
    <Slip className="space-y-3">
      <Req text="Can we try the logo in navy?" how="By WhatsApp on 9 Nov, logged" tag="Revision 2 of 2" tone="ok" />
      <Req text="One more round with a rounder cup?" how="From the client link" tag="Beyond the 2 rounds agreed" tone="out" />
      <Req text="Could you also do a website banner?" how="On a call, logged" tag="Outside the approved scope" tone="out" />
    </Slip>
  );
}

function Req({ text, how, tag, tone }: { text: string; how: string; tag: string; tone: "ok" | "out" }) {
  return (
    <div
      className={cx(
        "rounded-xl border-l-[3px] bg-white py-2.5 pl-3 pr-3",
        tone === "out" ? "border-[var(--lp-red)]" : "border-[var(--lp-blue)]",
      )}
    >
      <p className="text-[14px]">“{text}”</p>
      <p className="mt-0.5 text-[12px] text-[var(--lp-body)]">{how}</p>
      <p className={cx("mt-1 text-[12px] font-semibold", tone === "out" ? "text-[var(--lp-red)]" : "text-[var(--lp-blue)]")}>{tag}</p>
    </div>
  );
}

function ChangeOrderVisual() {
  return (
    <Slip>
      <p className="text-[12px] text-[var(--lp-body)]">Change order #1</p>
      <p className="mt-0.5 text-[16px] font-semibold">Website banner, 3 sizes</p>
      <dl className="mt-3 space-y-1.5 text-[13px] tabular-nums">
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">Price</dt>
          <dd className="font-semibold">₹6,000</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">Extra time</dt>
          <dd>2 days</dd>
        </div>
        <div className="flex justify-between border-t border-[var(--lp-rule)] pt-1.5">
          <dt className="text-[var(--lp-body)]">Contract total</dt>
          <dd>
            <s className="mr-2 text-[var(--lp-body)]">₹45,000</s>
            <b>₹51,000</b>
          </dd>
        </div>
      </dl>
      <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--lp-green)]">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M3.8 8.4 6.7 11.2 12.3 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Approved by Meera on 12 Nov
      </p>
    </Slip>
  );
}

/** A decorative QR-like pattern (deliberately not scannable: no real payment details on a marketing page). */
function FauxQr() {
  const cells = useMemo(() => {
    const out: [number, number][] = [];
    let seed = 7;
    for (let y = 0; y < 21; y++)
      for (let x = 0; x < 21; x++) {
        const finder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
        seed = (seed * 9301 + 49297) % 233280;
        if (!finder && seed / 233280 > 0.55) out.push([x, y]);
      }
    return out;
  }, []);
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" fill="var(--lp-ink)" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="var(--lp-ink)" />
    </g>
  );
  return (
    <svg viewBox="-1 -1 23 23" width="76" height="76" aria-hidden className="shrink-0 rounded bg-white">
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill="var(--lp-ink)" />
      ))}
      {finder(0, 0)}
      {finder(14, 0)}
      {finder(0, 14)}
    </svg>
  );
}

function InvoiceVisual() {
  return (
    <Slip>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--lp-blue)]">Tax invoice</p>
          <p className="lp-display text-[20px] tabular-nums">RS-2026-004</p>
        </div>
        <span className="rounded-full bg-[var(--lp-green-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--lp-green)]">
          Paid by UPI
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 text-[13px] tabular-nums">
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">Taxable value</dt>
          <dd>₹21,610</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">CGST 9%</dt>
          <dd>₹1,945</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">SGST 9%</dt>
          <dd>₹1,945</dd>
        </div>
        <div className="flex justify-between border-t-2 border-[var(--lp-ink)] pt-1.5 font-semibold">
          <dt>Total</dt>
          <dd>₹25,500</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-[var(--lp-paper)] p-3">
        <FauxQr />
        <p className="text-[12px] leading-snug text-[var(--lp-body)]">
          <span className="block font-semibold text-[var(--lp-ink)]">Scan to pay with any UPI app</span>
          The invoice number goes in as the payment note.
        </p>
      </div>
    </Slip>
  );
}

// ---------------------------------------------------------------- the app itself

function Workspace() {
  return (
    <section className="border-b border-[var(--lp-rule)] bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
          <h2 className="lp-display text-[36px] leading-[1.02] sm:text-[52px]">Your whole business, in one workspace.</h2>
          <div className="max-w-[34rem]">
            <p className="text-[17px] leading-relaxed text-[var(--lp-body)]">
              Projects, clients, quotes, invoices, approvals and expenses, with what needs you today at the top. Profit for every project,
              by month, quarter or April-to-March financial year.
            </p>
          </div>
        </div>
        <AppPreview />
        <ul className="mt-10 grid grid-cols-1 gap-x-10 gap-y-4 text-[15px] sm:grid-cols-2 lg:grid-cols-4">
          {[
            "Reminders for overdue payments, waiting approvals and deadlines",
            "Every project's status, deadline, value and what's paid",
            "Money received month by month, and profit per project",
            "The same app on your phone, with nothing hidden",
          ].map((f) => (
            <li key={f} className="flex gap-3 border-t border-[var(--lp-rule-strong)] pt-3">
              <svg width="18" height="18" viewBox="0 0 16 16" className="mt-[3px] shrink-0 text-[var(--lp-blue)]" aria-hidden>
                <path
                  d="M3.8 8.4 6.7 11.2 12.3 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const PREVIEW_NAV: [string, string[]][] = [
  ["Workspace", ["Overview", "Projects", "Clients"]],
  ["Work", ["Quotations", "Invoices", "Approvals"]],
  ["Business", ["Analytics", "Expenses"]],
];

/**
 * The Overview screen, built from the app's own components with example data (fictional names and amounts).
 * A picture of the product, not a working copy: it can't be focused or clicked.
 */
function AppPreview() {
  const projects: {
    title: string;
    client: string;
    status: "active" | "awaiting_approval" | "completed";
    due: string;
    value: string;
    paid: number;
  }[] = [
    { title: "Brand kit", client: "Chai & Co.", status: "active", due: "30 Nov", value: "₹51,000", paid: 50 },
    { title: "Menu card", client: "Tiffin Room", status: "awaiting_approval", due: "8 Dec", value: "₹18,000", paid: 0 },
    { title: "Launch reel", client: "Kora Studio", status: "completed", due: "28 Oct", value: "₹12,000", paid: 100 },
  ];
  const months: [string, number][] = [
    ["Jun", 38],
    ["Jul", 52],
    ["Aug", 30],
    ["Sep", 64],
    ["Oct", 48],
    ["Nov", 72],
  ];
  return (
    <div
      className="lp-app mt-12 overflow-hidden rounded-2xl border border-[var(--lp-rule-strong)] bg-canvas text-left"
      role="img"
      aria-label="The ScopeFlow Overview screen: key figures, reminders by urgency, projects with status, deadline, value and payment progress, and money received each month"
      inert
    >
      <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)]" aria-hidden>
        {/* Sidebar */}
        <div className="hidden flex-col bg-chrome p-3 md:flex">
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <LogoFull tone="white" className="h-[20px] w-auto" />
          </div>
          <div className={cx(buttonClass("primary", "sm"), "mt-3 w-full")}>+ New project</div>
          {PREVIEW_NAV.map(([group, items]) => (
            <div key={group} className="mt-4">
              <p className="px-2 pb-1 text-[11px] font-medium text-chrome-muted">{group}</p>
              {items.map((it) => (
                <p
                  key={it}
                  className={cx(
                    "relative rounded-md px-2 py-1.5 text-[12.5px] font-medium",
                    it === "Overview" ? "bg-chrome-2 text-white" : "text-chrome-text",
                  )}
                >
                  {it === "Overview" ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent" /> : null}
                  {it}
                  {it === "Approvals" ? (
                    <span className="num float-right rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-[16px] text-white">
                      2
                    </span>
                  ) : null}
                </p>
              ))}
            </div>
          ))}
        </div>
        {/* Overview (on phones: the app's compact top bar, as in the real app) */}
        <div className="min-w-0">
          <div className="flex h-12 items-center gap-2 border-b border-line bg-canvas px-3 md:hidden">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              className="text-ink-2"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <LogoFull className="h-[18px] w-auto" />
            <span className="flex-1" />
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-2"
            >
              <path d="M6 8.5a6 6 0 1 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5" />
              <path d="M10.3 20.5a1.9 1.9 0 0 0 3.4 0" />
            </svg>
          </div>
          <div className="min-w-0 p-4 sm:p-6">
            <p className="text-[12px] text-muted">Monday, 16 November</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <p className="display text-[24px] font-semibold leading-tight text-ink sm:text-[28px]">Hello, Raman</p>
              <span className={buttonClass("primary", "sm")}>New project</span>
            </div>
            <Figures label="Example figures" className="mb-4 mt-4">
              <Figure label="Active projects" tone="accent" value="4" note="6 open in total" />
              <Figure label="Waiting for approval" tone="warning" value="2" note="Scopes and change orders" />
              <Figure label="Outstanding" tone="danger" value="₹63,500" note="1 payment overdue" noteTone="danger" />
              <Figure label="Collected" tone="positive" value="₹1,24,000" note="Received on live projects" />
            </Figures>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
              <div className="min-w-0 space-y-4">
                <div className="rounded-xl border border-line bg-surface">
                  <p className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink">Reminders · 3</p>
                  {(
                    [
                      ["Invoice RS-2026-003 is overdue", "₹9,000 due 4 days ago", "bg-[#f04438]", "Overdue", "text-danger"],
                      [
                        "Follow up with Tiffin Room",
                        "Scope sent 3 days ago, not approved yet",
                        "bg-[#f79009]",
                        "Follow up",
                        "text-warning",
                      ],
                      ["“Packaging label” is due tomorrow", "Brand kit, for Chai & Co.", "bg-accent", "Coming up", "text-accent"],
                    ] as const
                  ).map(([t, d, rule, label, tone]) => (
                    <div key={t} className="relative flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                      <span className={cx("absolute inset-y-2 left-0 w-[3px] rounded-r-full", rule)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink">{t}</span>
                        <span className="block truncate text-[11.5px] text-muted">{d}</span>
                      </span>
                      <span className={cx("hidden text-[11.5px] font-medium sm:block", tone)}>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-line bg-surface">
                  <p className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink">Projects</p>
                  {projects.map((p) => (
                    <div
                      key={p.title}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_148px_52px_72px_60px]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium text-ink">{p.title}</span>
                        <span className="block truncate text-[11.5px] text-muted">{p.client}</span>
                      </span>
                      <span className="justify-self-end sm:justify-self-start">
                        <StatusBadge status={p.status} />
                      </span>
                      <span className="num hidden text-[12px] text-ink-2 sm:block">{p.due}</span>
                      <span className="num hidden justify-self-end text-[12px] font-medium text-ink sm:block">{p.value}</span>
                      <span className="hidden sm:block">
                        {p.status === "awaiting_approval" ? (
                          <span className="text-[11px] text-subtle">Not yet</span>
                        ) : (
                          <Meter value={p.paid} max={100} tone="positive" />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden rounded-xl border border-line bg-surface p-4 lg:block">
                <p className="text-[13px] font-semibold text-ink">Money in</p>
                <p className="mt-2 text-[11.5px] text-muted">This month</p>
                <p className="display num text-[20px] font-semibold text-ink">₹72,000</p>
                <div className="mt-4 grid h-[96px] grid-cols-6 items-end gap-1.5">
                  {months.map(([m, v], i) => (
                    <div key={m} className="flex h-full flex-col items-center justify-end gap-1">
                      <div
                        className={cx("w-full max-w-[22px] rounded-t-[3px]", i === months.length - 1 ? "bg-accent" : "bg-accent/35")}
                        style={{ height: `${v}px` }}
                      />
                      <span className="text-[10px] text-muted">{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the client's side

function ClientSide() {
  return (
    <section className="border-b border-[var(--lp-rule)]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-28">
        <div className="lg:order-2">
          <h2 className="lp-display text-[36px] leading-[1.02] sm:text-[52px]">Your client needs only the link.</h2>
          <p className="mt-5 max-w-[32rem] text-[17px] leading-relaxed text-[var(--lp-body)]">
            One private page per project, made for phones. It shows exactly what was agreed and where things stand, so there's less to
            explain on calls.
          </p>
          <dl className="mt-8 grid max-w-[34rem] gap-x-8 gap-y-5 sm:grid-cols-2">
            {[
              ["Approve or ask for changes", "The scope, change orders and extra revision rounds"],
              ["See what's left", "Revision rounds used and left, and deliverable progress"],
              ["Pay you directly", "Invoices with a UPI QR code. Money goes straight to you"],
              ["Keep a copy", "Download the scope and invoices as PDFs"],
            ].map(([t, d]) => (
              <div key={t} className="border-t-2 border-[var(--lp-ink)] pt-3">
                <dt className="text-[15px] font-semibold">{t}</dt>
                <dd className="mt-1 text-[14px] leading-relaxed text-[var(--lp-body)]">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lg:order-1">
          <div className="lp-phone mx-auto w-[280px]">
            <div className="rounded-[26px] bg-white p-4 pt-6 text-[12px]">
              <p className="text-[11px] text-[var(--lp-body)]">Raman Studio</p>
              <p className="lp-display mt-0.5 text-[19px] leading-tight">Brand kit</p>
              <p className="mt-1 inline-block rounded-full bg-[var(--lp-blue-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--lp-blue)]">
                In progress
              </p>
              <div className="mt-4 space-y-3">
                {[
                  ["Logo and colours", 2, 2, "Delivered"],
                  ["Packaging label", 0, 1, "In progress"],
                  ["Banner, 3 sizes", 0, 1, "Not started"],
                ].map(([t, used, of, s]) => (
                  <div key={t as string}>
                    <p className="flex justify-between gap-2">
                      <span className="font-medium">{t}</span>
                      <span className="text-[var(--lp-body)]">{s}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1" aria-hidden>
                      {Array.from({ length: of as number }, (_, i) => (
                        <i
                          key={i}
                          className={cx("h-1.5 w-6 rounded-full", i < (used as number) ? "bg-[var(--lp-blue)]" : "bg-[var(--lp-rule)]")}
                        />
                      ))}
                      <span className="ml-1 text-[11px] text-[var(--lp-body)]">
                        {used} of {of} rounds used
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl bg-[var(--lp-paper)] p-3">
                <p className="flex justify-between font-semibold tabular-nums">
                  <span>Final delivery</span>
                  <span>₹25,500</span>
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--lp-body)]">Due 30 Nov</p>
                <div className="mt-2 rounded-full bg-[var(--lp-blue)] py-1.5 text-center text-[12px] font-semibold text-white">
                  Pay with UPI
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- safety

function Safe() {
  const items: [string, string][] = [
    [
      "Agreements can't be changed afterwards",
      "Each approved version is stored with a fingerprint of its exact content, plus who approved it and when. The approval record downloads as a PDF.",
    ],
    [
      "Only you see your business",
      "Your clients see only their own project page. Expenses, notes and your other clients stay private to you.",
    ],
    ["Backed up every week", "The whole database is encrypted and backed up weekly, and every backup is checked by restoring it."],
    ["Your money never passes through us", "ScopeFlow records payments; clients pay you directly by UPI or however you agree."],
  ];
  return (
    <section className="border-b border-[var(--lp-rule)] bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <h2 className="lp-display max-w-2xl text-[32px] leading-[1.05] sm:text-[44px]">A record you can rely on.</h2>
        <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([t, d]) => (
            <div key={t} className="border-t border-[var(--lp-rule-strong)] pt-4">
              <dt className="text-[16px] font-semibold leading-snug">{t}</dt>
              <dd className="mt-2 text-[14px] leading-relaxed text-[var(--lp-body)]">{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- questions

const QA: [string, string][] = [
  [
    "Does my client need an account?",
    "No. They open a private link on any phone or computer, review the scope and approve it, or ask for changes.",
  ],
  [
    "Is it free?",
    "Yes, for 2 active projects and 5 clients at a time, with every core feature: scopes, approvals, revision tracking, change orders, quotes, invoices and payment tracking. Expenses and analytics are free for everyone during the beta. No card needed.",
  ],
  [
    "Can I make GST invoices?",
    "Yes. Add your GSTIN and address once, then create a tax invoice from any payment. CGST and SGST, or IGST, are worked out for you, and numbering stays in order.",
  ],
  [
    "What if my client asks for changes on WhatsApp?",
    "Log the request on the project in a few taps. It's checked against the approved scope like any other request, and your client sees it on their page.",
  ],
  [
    "Does ScopeFlow take payments?",
    "No. It records the payments you receive. Your client pays you directly, for example by scanning the UPI QR code on the invoice.",
  ],
  ["Can I use it on my phone?", "Yes. Everything works on a phone, for you and for your clients."],
];

function Questions() {
  return (
    <section className="border-b border-[var(--lp-rule)]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:py-24">
        <h2 className="lp-display text-[32px] leading-[1.05] sm:text-[44px]">Questions freelancers ask.</h2>
        <div className="border-t border-[var(--lp-rule-strong)]">
          {QA.map(([q, a]) => (
            <details key={q} className="lp-qa group border-b border-[var(--lp-rule)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[16px] font-semibold">
                {q}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 16 16"
                  className="shrink-0 text-[var(--lp-body)] transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="max-w-[40rem] pb-5 text-[15px] leading-relaxed text-[var(--lp-body)]">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- closing

function Closing() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="lp-closing relative mx-auto max-w-6xl overflow-hidden rounded-[24px] bg-chrome px-6 py-14 text-white sm:px-12 sm:py-20">
        <h2 className="lp-display relative max-w-3xl text-[38px] leading-[1.02] sm:text-[60px]">Start your next job on the record.</h2>
        <p className="relative mt-5 max-w-xl text-[17px] leading-relaxed text-chrome-text">
          Set up your first scope in a few minutes. Free for 2 active projects, no card needed.
        </p>
        <div className="relative mt-8 flex flex-wrap gap-3">
          <Link to="/signup" className={btnPrimary}>
            Start free
          </Link>
          <Link
            to="/pricing"
            className={cx(
              buttonClass("ghost"),
              "h-11 px-5 text-[15px] font-semibold text-white ring-1 ring-chrome-line hover:bg-chrome-2 hover:text-white",
            )}
          >
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
