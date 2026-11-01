import "@fontsource-variable/bricolage-grotesque/opsz.css";
import { useState } from "react";
import { Link } from "react-router";
import { buttonClass, cx } from "@/components/ui";
import { SiteFooter } from "@/components/site-footer";

/**
 * Home page. One memorable thing: the hero plays out the moment ScopeFlow exists for —
 * a client asks for "one small change" outside the approved scope line, and it becomes
 * a priced change order. Everything else stays quiet.
 */
export default function Landing() {
  return (
    <div className="landing min-h-dvh bg-[var(--lp-paper)] text-[var(--lp-ink)]">
      <Hero />
      <Timeline />
      <ClientSide />
      <Toolkit />
      <Closing />
      <SiteFooter />
    </div>
  );
}

function Nav() {
  return (
    <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
      <Link to="/" aria-label="ScopeFlow home" className="flex items-center gap-2 text-white">
        <span className="inline-flex items-center gap-2 font-semibold tracking-[-0.02em]">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
            <path d="M2 7V2h5M15 2h5v5M20 15v5h-5M7 20H2v-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <rect x="7" y="7" width="8" height="8" rx="1.5" fill="var(--lp-amber)" />
          </svg>
          ScopeFlow
        </span>
        <span className="hidden rounded-full border border-white/30 px-2 py-0.5 text-[11px] font-medium leading-none text-white/80 sm:inline">Beta</span>
      </Link>
      <nav className="flex items-center gap-1 sm:gap-2">
        <Link to="/pricing" className="hidden whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium text-white/85 hover:text-white sm:block">
          Pricing
        </Link>
        <Link to="/login" className="whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium text-white/85 hover:text-white">
          Sign in
        </Link>
        <Link to="/signup" className="whitespace-nowrap rounded-lg bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--lp-cobalt-deep)] hover:bg-white/90">
          Start free
        </Link>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="lp-hero relative overflow-hidden bg-[var(--lp-cobalt)] text-white">
      <Nav />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-10 lg:pb-28 lg:pt-16">
        <div>
          <h1 className="lp-display lp-hang text-[44px] leading-[0.98] [text-wrap:pretty] sm:text-[64px] lg:text-[72px]">
            “Just one small change” now comes with a price.
          </h1>
          <p className="mt-7 max-w-[34rem] text-[17px] leading-relaxed text-white/85 sm:text-lg">
            ScopeFlow keeps the scope your client approved on record, checks every request against it, and turns the extras into
            change orders they approve — with a price — before you start.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/signup" className="rounded-xl bg-[var(--lp-amber)] px-6 py-3.5 text-[15px] font-semibold text-[var(--lp-ink)] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-px">
              Start free
            </Link>
            <Link to="/pricing" className="rounded-xl px-5 py-3.5 text-[15px] font-medium text-white ring-1 ring-white/35 hover:ring-white/70">
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-white/70">Free for 2 active projects. No card, no client accounts.</p>
        </div>
        <ScopeDemo />
      </div>
    </section>
  );
}

/** The hero moment: approved scope, an out-of-scope request, a priced change order. */
function ScopeDemo() {
  const [run, setRun] = useState(0);
  return (
    <div className="relative mx-auto w-full max-w-[520px] lg:mx-0 lg:justify-self-end">
      <div key={run} className="lp-demo" aria-label="Example: a client asks for something outside the approved scope, and it becomes a priced change order" role="img">
        {/* The approved scope, inside the scope line */}
        <div className="lp-scope-line rounded-[22px] p-3 sm:p-4">
          <div className="rounded-2xl bg-white p-5 text-[var(--lp-ink)] shadow-[0_30px_60px_-30px_rgba(5,15,45,0.7)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[12px] text-[#5b6680]">Scope v2 for Chai &amp; Co.</p>
                <p className="lp-display mt-0.5 text-[22px] leading-tight">Brand kit</p>
              </div>
              <span className="lp-approved inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--lp-mint-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--lp-mint)]">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Approved, locked
              </span>
            </div>
            <ul className="mt-5 space-y-2.5 text-[14px]">
              <li className="flex items-center justify-between gap-3">
                <span>Logo and colour palette</span>
                <span className="lp-meter" aria-hidden>
                  <i className="on" />
                  <i />
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>Packaging label</span>
                <span className="lp-meter" aria-hidden>
                  <i className="on" />
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 text-[#5b6680]">
                <span>Not included: printing, copywriting</span>
              </li>
            </ul>
            <div className="mt-5 flex items-baseline justify-between border-t border-[var(--lp-line)] pt-4">
              <span className="text-[13px] text-[#5b6680]">Contract total</span>
              <span className="lp-total lp-display text-[26px] tabular-nums">
                <span className="old">₹45,000</span>
                <span className="new">₹51,000</span>
              </span>
            </div>
          </div>
        </div>

        {/* The request lands outside the line */}
        <div className="lp-request relative -mt-2 ml-auto mr-2 max-w-[330px] sm:mr-6">
          <div className="rounded-2xl rounded-tr-md bg-[#e9eefb] px-4 py-3 text-[14px] text-[var(--lp-ink)] shadow-[0_18px_40px_-20px_rgba(5,15,45,0.8)]">
            <p className="text-[12px] font-medium text-[#5b6680]">Meera from Chai &amp; Co.</p>
            <p className="mt-0.5">Love it! Can you also do a website banner? Small one.</p>
          </div>
          <p className="lp-flag mt-2 flex items-center justify-end gap-1.5 text-[12px] font-semibold text-[var(--lp-amber)]">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M6 1.5 11 10.5H1L6 1.5Z" fill="currentColor" />
              <path d="M6 5v2.4" stroke="var(--lp-cobalt)" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Outside the approved scope
          </p>
        </div>

        <div className="lp-co mt-3 rounded-2xl bg-[var(--lp-cobalt-deep)] p-4 text-white ring-1 ring-white/10 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] text-white/65">Change order #1, sent for approval</p>
              <p className="mt-0.5 text-[15px] font-semibold">Website banner, 3 sizes</p>
            </div>
            <p className="lp-display text-[24px] text-[var(--lp-amber)] tabular-nums">+₹6,000</p>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[12px] text-white/70">
            <span className="lp-co-ok inline-flex items-center gap-1 rounded-full bg-[var(--lp-mint)] px-2 py-0.5 font-semibold text-white">Approved by Meera</span>
            <span>Budget and due date updated</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setRun((r) => r + 1)}
        className="mt-4 text-[12px] font-medium text-white/70 underline-offset-4 hover:text-white hover:underline"
      >
        Play again
      </button>
    </div>
  );
}

const EVENTS: { when: string; what: string; tone?: "mint" | "amber" }[] = [
  { when: "Mon 10:02", what: "You send scope v1 with deliverables, revision limits and what's not included" },
  { when: "Mon 18:40", what: "Meera opens the link on her phone" },
  { when: "Tue 09:15", what: "She approves. The scope is locked and fingerprinted", tone: "mint" },
  { when: "Thu 16:20", what: "Revision 2 of 2 used on the logo. ScopeFlow keeps count" },
  { when: "Fri 11:05", what: "“Can you also do a banner?” becomes change order #1 for ₹6,000", tone: "amber" },
  { when: "Mon 12:30", what: "Final payment of ₹51,000 marked as received", tone: "mint" },
];

function Timeline() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
      <div className="max-w-2xl">
        <h2 className="lp-display text-[34px] leading-[1.05] sm:text-[46px]">One project, from first draft to fully paid.</h2>
        <p className="mt-4 text-[17px] leading-relaxed text-[#4a5470]">
          Every step leaves a record you and your client can both see. When someone remembers it differently, the timeline doesn't.
        </p>
      </div>
      <ol className="lp-rail mt-14 grid gap-8 lg:grid-cols-6 lg:gap-5">
        {EVENTS.map((e) => (
          <li key={e.when} className="relative pl-8 lg:pl-0 lg:pt-9">
            <span
              className={cx(
                "lp-dot absolute left-0 top-1 size-[15px] rounded-full border-[3px] lg:top-0",
                e.tone === "mint" ? "border-[var(--lp-mint)] bg-[var(--lp-mint)]" : e.tone === "amber" ? "border-[var(--lp-amber)] bg-[var(--lp-amber)]" : "border-[var(--lp-cobalt)] bg-[var(--lp-paper)]",
              )}
              aria-hidden
            />
            <p className="text-[13px] font-semibold tabular-nums text-[var(--lp-cobalt)]">{e.when}</p>
            <p className="mt-1.5 text-[15px] leading-snug">{e.what}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClientSide() {
  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
        <PhonePortal />
        <div>
          <h2 className="lp-display text-[34px] leading-[1.05] sm:text-[46px]">Your client taps one link. That's it.</h2>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-[#4a5470]">
            Share the link on WhatsApp or email. Your client reads the scope, sees exactly what's included and what isn't, and approves —
            no account, no app, no password.
          </p>
          <dl className="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2">
            {[
              ["Approvals that hold up", "Each approved version is stored with a fingerprint, so “I never agreed to that” has an answer."],
              ["Limits everyone can see", "Clients see how many revision rounds are left, and what an extra one costs."],
              ["Private by default", "Links can expire or be revoked any time. Client pages are never indexed."],
              ["Works on any phone", "Built for the small screen your client actually reads it on."],
            ].map(([t, d]) => (
              <div key={t}>
                <dt className="text-[15px] font-semibold">{t}</dt>
                <dd className="mt-1.5 text-[14px] leading-relaxed text-[#4a5470]">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function PhonePortal() {
  return (
    <div className="mx-auto w-[290px] rounded-[44px] bg-[var(--lp-ink)] p-3 shadow-[0_40px_80px_-40px_rgba(15,30,69,0.6)] sm:w-[310px]" aria-hidden>
      <div className="overflow-hidden rounded-[34px] bg-[var(--lp-paper)]">
        <div className="mx-auto mt-2.5 h-5 w-24 rounded-full bg-[var(--lp-ink)]" />
        <div className="px-5 pb-6 pt-4">
          <p className="text-[11px] text-[#5b6680]">Raman Studio, for Chai &amp; Co.</p>
          <p className="lp-display mt-1 text-[22px] leading-tight">Brand kit</p>
          <div className="mt-4 rounded-xl bg-white p-3.5 text-[12px] shadow-sm">
            <p className="font-semibold">Logo and colour palette</p>
            <p className="mt-0.5 text-[#5b6680]">2 revision rounds included</p>
            <div className="mt-3 border-t border-[var(--lp-line)] pt-3">
              <p className="font-semibold">Packaging label</p>
              <p className="mt-0.5 text-[#5b6680]">1 revision round included</p>
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-white p-3.5 text-[12px] shadow-sm">
            <p className="font-semibold">Not included</p>
            <p className="mt-0.5 text-[#5b6680]">Printing, copywriting</p>
            <p className="mt-2 flex justify-between">
              <span className="text-[#5b6680]">Each extra round</span>
              <span className="font-semibold">₹1,500</span>
            </p>
          </div>
          <div className="mt-3 flex items-baseline justify-between px-1 text-[12px]">
            <span className="text-[#5b6680]">Total</span>
            <span className="lp-display text-[20px]">₹45,000</span>
          </div>
          <div className="mt-4 rounded-xl bg-[var(--lp-cobalt)] py-3 text-center text-[13px] font-semibold text-white">Approve scope</div>
          <div className="mt-2 rounded-xl py-2.5 text-center text-[13px] font-medium text-[var(--lp-cobalt)] ring-1 ring-[var(--lp-line)]">Request changes</div>
        </div>
      </div>
    </div>
  );
}

function Toolkit() {
  const items = [
    ["Scope check", "Flags vague words like “etc.” or “unlimited” and missing exclusions before you send."],
    ["Revision limits", "Set rounds per deliverable. Requests beyond them are flagged as out of scope automatically."],
    ["Change orders", "Price extra work as fixed or hourly with extra days. Budget, timeline and payments update on approval."],
    ["Payments and deadlines", "Milestones you mark as paid, with what's overdue and what's due in the next two weeks."],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
      <h2 className="lp-display max-w-2xl text-[34px] leading-[1.05] sm:text-[46px]">Small tools for the conversations freelancers dread.</h2>
      <div className="mt-12 grid gap-px overflow-hidden rounded-[18px] bg-[var(--lp-line)] sm:grid-cols-2">
        {items.map(([t, d]) => (
          <div key={t} className="bg-[var(--lp-paper)] p-7 sm:p-8">
            <h3 className="text-[17px] font-semibold">{t}</h3>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed text-[#4a5470]">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="px-4 pb-10 sm:px-6">
      <div className="lp-closing relative mx-auto max-w-6xl overflow-hidden rounded-[28px] bg-[var(--lp-cobalt-deep)] px-6 py-16 text-white sm:px-14 sm:py-20">
        <h2 className="lp-display max-w-3xl text-[36px] leading-[1.02] sm:text-[56px]">Send your next scope with ScopeFlow.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/80">
          Free for 2 active projects at a time, with every core feature. Upgrade only when your business needs more.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link to="/signup" className="rounded-xl bg-[var(--lp-amber)] px-6 py-3.5 text-[15px] font-semibold text-[var(--lp-ink)]">
            Start free
          </Link>
          <Link to="/pricing" className={cx(buttonClass("ghost"), "rounded-xl px-5 py-3.5 text-[15px] text-white ring-1 ring-white/35 hover:bg-white/10 hover:text-white")}>
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
