/** Pieces of the home page: the example job record, a decorative QR pattern and the app preview (example data only). */
import { useMemo, type ReactNode } from "react";
import { Figure, Figures, Meter, StatusBadge, buttonClass, cx } from "@/components/ui";
import { LogoFull } from "@/components/brand";

export type Entry = { date: string; what: ReactNode; note?: string; amount?: string; mark?: "ok" | "out" | "paid" };
export const LEDGER: Entry[] = [
  { date: "2 Nov", what: "Quote sent: 3 deliverables, GST included", note: "Valid until 16 Nov", amount: "₹45,000" },
  { date: "4 Nov", what: "Scope approved by Meera", note: "Locked, with a fingerprint", mark: "ok" },
  { date: "9 Nov", what: "“Can we try the logo in navy?”", note: "By WhatsApp, logged. Revision 2 of 2", mark: "ok" },
  { date: "11 Nov", what: "“Could you also do a website banner?”", note: "Outside the approved scope", mark: "out" },
  { date: "12 Nov", what: "Change order #1 approved", note: "Banner in 3 sizes, 2 extra days", amount: "+₹6,000" },
  { date: "15 Nov", what: "Invoice RS-2026-004, CGST + SGST", note: "50% advance", amount: "₹25,500" },
  { date: "16 Nov", what: "Paid by UPI", note: "UTR 4471 0938", amount: "₹25,500", mark: "paid" },
];


export function Mark({ kind }: { kind: Entry["mark"] }) {
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
export function LedgerSheet() {
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


/** A decorative QR-like pattern (deliberately not scannable: no real payment details on a marketing page). */
export function FauxQr() {
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


export const PREVIEW_NAV: [string, string[]][] = [
  ["Workspace", ["Overview", "Projects", "Clients"]],
  ["Work", ["Quotations", "Invoices", "Approvals"]],
  ["Business", ["Analytics", "Expenses"]],
];

/**
 * The Overview screen, built from the app's own components with example data (fictional names and amounts).
 * A picture of the product, not a working copy: it can't be focused or clicked.
 */
export function AppPreview() {
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


export const QA: [string, string][] = [
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

