import "@fontsource-variable/bricolage-grotesque/opsz.css";
import { useEffect, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { buttonClass, cx } from "@/components/ui";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { HOME_FAQ as QA } from "@/lib/faq";
import { useSeo } from "@/lib/seo";
import { useBlogList } from "@/lib/blog";
import { categoryOf, formatPostDate } from "@/lib/blog-content";
import { AppPreview, FauxQr, LedgerSheet } from "./landing-parts";

/**
 * Home page, dark and animated. The logo's charcoal, with its cobalt used as light (glows, beams, sheen).
 * Motion is orchestrated per section and stops entirely with reduced motion.
 * Everything shown exists in the product today. ScopeFlow's checks are rule-based (no AI is claimed);
 * names and amounts are examples; there are no invented customers or numbers.
 */
export default function Landing() {
  useSeo("/");
  useReveal();
  return (
    <div className="lp min-h-dvh overflow-x-clip bg-[var(--lp-bg)] text-[var(--lp-text)]">
      <Nav />
      <main>
        <Hero />
        <Triage />
        <Steps />
        <Bento />
        <Workspace />
        <FromTheBlog />
        <Questions />
        <Closing />
      </main>
      <div className="lp-foot">
        <SiteFooter />
      </div>
    </div>
  );
}

/**
 * Adds data-in to [data-reveal] elements once they reach the lower part of the screen, or have been
 * scrolled past (so a fast flick never leaves a section blank). CSS does the animation.
 */
function useReveal() {
  useEffect(() => {
    let pending = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    let frame = 0;
    const check = () => {
      frame = 0;
      const limit = window.innerHeight * 0.9;
      pending = pending.filter((el) => {
        if (el.getBoundingClientRect().top < limit) {
          el.dataset.in = "1";
          return false;
        }
        return true;
      });
      if (!pending.length) stop();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return () => {
      stop();
      cancelAnimationFrame(frame);
    };
  }, []);
}

/** Lets a card glow where the pointer is. */
const spotlight = (e: PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
};

const btnPrimary = cx(buttonClass("primary"), "lp-btn-glow h-12 rounded-xl px-6 text-[15px] font-semibold");
const btnGhost =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold text-[var(--lp-text)] ring-1 ring-white/15 transition hover:bg-white/5 hover:ring-white/30";

function Check({ className = "mt-[3px] text-[var(--lp-glow)]" }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" className={cx("shrink-0", className)} aria-hidden>
      <path d="M3.8 8.4 6.7 11.2 12.3 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------- nav

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <PublicHeader
      tone="dark"
      className={cx("sticky top-0 z-40 transition-colors duration-300", scrolled ? "border-b border-white/[0.07] bg-[#090c12]/80 backdrop-blur-xl" : "border-b border-transparent")}
    />
  );
}

// ---------------------------------------------------------------- hero

function Hero() {
  return (
    <section className="relative isolate">
      <div className="lp-aurora" aria-hidden>
        <span />
        <span />
      </div>
      <div className="lp-floor" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-4 pb-20 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:pb-32 lg:pt-24">
        <div className="lp-hero-copy">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] text-[var(--lp-muted)]">
            <span className="lp-live size-1.5 rounded-full bg-[#32d583]" aria-hidden />
            New: GST invoices with UPI, and one-tap PDFs
          </p>
          <h1 className="lp-display lp-sheen mt-6 text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px]">Get paid for every “just one small change”.</h1>
          <p className="mt-5 text-[20px] font-semibold text-white sm:text-[24px]" data-testid="hero-subline">Every client job, on the record.</p>
          <p className="mt-4 max-w-[34rem] text-[17px] leading-relaxed text-[var(--lp-muted)] sm:text-[19px]">
            Quote it, get it approved, check every “small change” against it, invoice with GST and see what you actually earned. For
            freelancers who are done doing extra work for free.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/signup" className={btnPrimary}>
              Start free
            </Link>
            <a href="#how" className={btnGhost}>
              See how it works
            </a>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[var(--lp-muted)]">
            {["Free for 2 active projects", "No card needed", "Clients never need an account"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="text-[#32d583]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <div className="lp-halo" aria-hidden />
          <div className="lp-scan-wrap relative">
            <LedgerSheet />
            <span className="lp-scan" aria-hidden />
          </div>
          <Float className="lp-float-a right-[4%] top-[-58px]" tone="out" title="Outside the approved scope" body="“Also a website banner?”" />
          <Float className="lp-float-b bottom-[-62px] left-[6%]" tone="in" title="Change order approved" body="+₹6,000, 2 extra days" />
        </div>
      </div>
    </section>
  );
}

function Float({ className, tone, title, body }: { className: string; tone: "in" | "out"; title: string; body: string }) {
  return (
    <div className={cx("lp-float absolute z-10 hidden items-center gap-3 rounded-2xl border border-white/10 bg-[#121620]/95 px-3.5 py-2.5 shadow-2xl sm:flex", className)} aria-hidden>
      <span className={cx("grid size-8 place-items-center rounded-lg", tone === "out" ? "bg-[#f04438]/20 text-[#fda29b]" : "bg-[#17b26a]/20 text-[#75e0a7]")}>
        {tone === "out" ? (
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M8 3.5v5.2M8 11.6v.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M3.8 8.4 6.7 11.2 12.3 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-[13px] leading-tight">
        <span className="block font-semibold text-white">{title}</span>
        <span className="block text-[var(--lp-muted)]">{body}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- request triage (looping)

const INCOMING: { from: string; via: string; text: string }[] = [
  { from: "Meera", via: "WhatsApp", text: "Can we try the logo in navy?" },
  { from: "Meera", via: "Client link", text: "One more round with a rounder cup?" },
  { from: "Meera", via: "Phone call", text: "Could you also do a website banner?" },
];
const OUTCOME: { title: string; body: string; tone: "in" | "warn" | "out" }[] = [
  { title: "Within scope", body: "Revision 2 of 2 for “Logo”", tone: "in" },
  { title: "Beyond the rounds agreed", body: "Extra round at ₹1,500, if your client agrees", tone: "warn" },
  { title: "Outside the approved scope", body: "Turn it into a change order", tone: "out" },
];

function Triage() {
  return (
    <section className="lp-cv relative border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <h2 className="lp-display text-[36px] leading-[1.02] text-white sm:text-[54px]">Every request, sorted the moment it arrives.</h2>
          <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--lp-muted)]">
            From the client link, or logged from WhatsApp, a call or email: each one is checked against the scope your client approved.
          </p>
        </div>
        <div
          className="lp-triage mt-16 grid grid-cols-1 items-center gap-6 lg:grid-cols-[1fr_200px_1fr] lg:gap-8"
          data-reveal
          role="img"
          aria-label="Three client requests checked against the approved scope: the first is within scope, the second goes beyond the revision rounds agreed, the third is outside the scope and becomes a change order"
        >
          <div className="space-y-3" aria-hidden>
            {INCOMING.map((m, i) => (
              <div key={m.text} className="lp-in rounded-2xl border border-white/10 bg-white/[0.04] p-4" style={{ "--i": i } as CSSProperties}>
                <p className="flex items-center justify-between text-[12px] text-[var(--lp-muted)]">
                  <span>{m.from}</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{m.via}</span>
                </p>
                <p className="mt-1.5 text-[15px] text-white">“{m.text}”</p>
              </div>
            ))}
          </div>
          <div className="lp-core relative mx-auto grid size-[180px] place-items-center" aria-hidden>
            <span className="lp-ring" />
            <span className="lp-ring lp-ring-2" />
            <span className="lp-ring lp-ring-3" />
            <div className="relative grid size-[104px] place-items-center rounded-full border border-[var(--lp-glow)]/40 bg-[#0d1a33] text-center shadow-[0_0_60px_-10px_var(--lp-glow)]">
              <span>
                <span className="block text-[12px] text-[var(--lp-muted)]">Checked against</span>
                <span className="block text-[14px] font-semibold text-white">Scope v2</span>
              </span>
            </div>
          </div>
          <div className="space-y-3" aria-hidden>
            {OUTCOME.map((o, i) => (
              <div
                key={o.title}
                className={cx(
                  "lp-out rounded-2xl border p-4",
                  o.tone === "in" ? "border-[#17b26a]/30 bg-[#17b26a]/[0.08]" : o.tone === "warn" ? "border-[#f79009]/30 bg-[#f79009]/[0.08]" : "border-[#f04438]/30 bg-[#f04438]/[0.08]",
                )}
                style={{ "--i": i } as CSSProperties}
              >
                <p className={cx("text-[13px] font-semibold", o.tone === "in" ? "text-[#75e0a7]" : o.tone === "warn" ? "text-[#fec84b]" : "text-[#fda29b]")}>{o.title}</p>
                <p className="mt-1 text-[15px] text-white">{o.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the job, step by step

const STEPS: [string, string][] = [
  ["Quote", "Deliverables, revision rounds, what's not included. Fixed, hourly or per-unit prices, GST, and a valid-until date."],
  ["Approve", "Your client opens a private link on their phone and approves. The version is locked with a fingerprint."],
  ["Check", "Every request is counted against the rounds agreed. Extras are flagged the moment they arrive."],
  ["Change", "Price extra work as a change order. Budget, dates and payments update when your client approves."],
  ["Get paid", "GST invoice with a UPI QR code from any payment. Record part payments and see what's owed."],
];

function Steps() {
  return (
    <section id="how" className="lp-cv relative scroll-mt-16 border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
        <div className="max-w-2xl" data-reveal>
          <h2 className="lp-display text-[36px] leading-[1.02] text-white sm:text-[54px]">From “yes” to “paid”, in five steps.</h2>
          <p className="mt-5 text-[17px] leading-relaxed text-[var(--lp-muted)]">One record carries the job from the first quote to the last payment, so nobody has to remember what was agreed.</p>
        </div>
        <ol className="lp-steps relative mt-16 grid grid-cols-1 gap-10 lg:grid-cols-5 lg:gap-6" data-reveal>
          <span className="lp-track" aria-hidden />
          {STEPS.map(([t, d], i) => (
            <li key={t} className="lp-step relative pl-14 lg:pl-0 lg:pt-16" style={{ "--i": i } as CSSProperties}>
              <span className="lp-node absolute left-0 top-0 grid size-10 place-items-center rounded-full border border-[var(--lp-glow)]/50 bg-[#0d1a33] text-[14px] font-semibold text-white" aria-hidden>
                {i + 1}
              </span>
              <h3 className="text-[18px] font-semibold text-white">{t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--lp-muted)]">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- bento

function Tile({ className, title, body, children }: { className?: string; title: string; body: string; children?: ReactNode }) {
  return (
    <div onPointerMove={spotlight} className={cx("lp-tile relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[var(--lp-surface)] p-6 sm:p-7", className)} data-reveal>
      <div className="relative">
        <h3 className="text-[19px] font-semibold text-white">{title}</h3>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-[var(--lp-muted)]">{body}</p>
      </div>
      {children ? <div className="relative mt-6">{children}</div> : null}
    </div>
  );
}

function Bento() {
  return (
    <section id="product" className="lp-cv relative scroll-mt-16 border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
        <div className="max-w-2xl" data-reveal>
          <h2 className="lp-display text-[36px] leading-[1.02] text-white sm:text-[54px]">Everything a client job needs.</h2>
          <p className="mt-5 text-[17px] leading-relaxed text-[var(--lp-muted)]">Made for Indian freelancers and small studios, and for anyone who bills in another currency too.</p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
          <Tile className="md:col-span-4" title="Quotes your client can't misread" body="Price each line fixed, by the hour or per unit, add a discount and GST, and set how long the quote stays open. Save your own templates.">
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4 text-[13px]">
              {(
                [
                  ["Social post designs", "10 posts × ₹500", "₹5,000"],
                  ["Launch reel edit", "6 h × ₹1,200", "₹7,200"],
                  ["Content calendar", "Fixed", "₹3,000"],
                ] as const
              ).map(([t, b, a]) => (
                <p key={t} className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-2 last:border-0">
                  <span className="min-w-0">
                    <span className="text-white">{t}</span>
                    <span className="ml-2 text-[12px] text-[var(--lp-muted)]">{b}</span>
                  </span>
                  <span className="tabular-nums text-white">{a}</span>
                </p>
              ))}
              <p className="mt-2 flex justify-between border-t border-white/20 pt-2 font-semibold tabular-nums text-white">
                <span>Total with GST 18%</span>
                <span>₹17,936</span>
              </p>
            </div>
          </Tile>
          <Tile className="md:col-span-2" title="Approval without an account" body="One private link, opened on any phone. Approve, or ask for changes.">
            <div className="mx-auto w-[190px] rounded-[22px] border border-white/10 bg-white p-3 text-[11px] text-[#101828]">
              <p className="text-[10px] text-[#667085]">Raman Studio sent you a scope</p>
              <p className="lp-display text-[16px]">Brand kit</p>
              <p className="mt-2 flex justify-between border-t border-[#e4e7ec] pt-1.5 font-semibold tabular-nums">
                <span>Total</span>
                <span>₹45,000</span>
              </p>
              <p className="mt-2 rounded-lg bg-[#005dd4] py-1.5 text-center font-semibold text-white">Approve scope</p>
            </div>
          </Tile>
          <Tile className="md:col-span-2" title="Change orders" body="Extra work gets a price and extra days. Your client approves before you start.">
            <p className="flex items-center justify-between rounded-xl border border-[#17b26a]/30 bg-[#17b26a]/[0.08] px-3.5 py-2.5 text-[13px]">
              <span className="text-[#75e0a7]">Change order #1 approved</span>
              <span className="font-semibold tabular-nums text-white">+₹6,000</span>
            </p>
          </Tile>
          <Tile className="md:col-span-2" title="GST invoices with UPI" body="CGST and SGST or IGST worked out. A QR code your client scans to pay you directly.">
            <div className="flex items-center gap-3">
              <FauxQr />
              <p className="text-[13px] leading-snug text-[var(--lp-muted)]">
                <span className="block font-semibold text-white">RS-2026-004</span>
                ₹25,500, paid by UPI
              </p>
            </div>
          </Tile>
          <Tile className="md:col-span-2" title="Reminders that matter" body="Overdue payments, waiting approvals, deadlines and your own follow-ups, most urgent first.">
            <ul className="space-y-1.5 text-[13px]">
              {(
                [
                  ["Invoice RS-2026-003 is overdue", "bg-[#f04438]"],
                  ["Follow up with Tiffin Room", "bg-[#f79009]"],
                  ["“Packaging label” is due tomorrow", "bg-[var(--lp-glow)]"],
                ] as const
              ).map(([t, dot]) => (
                <li key={t} className="flex items-center gap-2.5 text-white">
                  <span className={cx("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </Tile>
          <Tile className="md:col-span-3" title="Know what you earned" body="Money received, invoiced and spent, and profit on every project, by month, quarter or April-to-March financial year.">
            <div className="flex h-[92px] items-end gap-2" aria-hidden>
              {[38, 52, 30, 64, 48, 72, 58, 80].map((h, i) => (
                <span key={i} className="lp-bar w-full rounded-t-md" style={{ "--h": `${h}px`, "--i": i } as CSSProperties} />
              ))}
            </div>
          </Tile>
          <Tile className="md:col-span-3" title="Safe by design" body="What you agree can't be changed afterwards. Only you see your business. Everything is encrypted and backed up every week.">
            <ul className="grid grid-cols-1 gap-2 text-[13px] text-white sm:grid-cols-3">
              {["Locked approvals", "Private by default", "Weekly encrypted backup"].map((t) => (
                <li key={t} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2">
                  <Check className="text-[var(--lp-glow)]" />
                  {t}
                </li>
              ))}
            </ul>
          </Tile>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the app itself

function Workspace() {
  return (
    <section className="lp-cv relative border-t border-white/[0.06]">
      <div className="lp-aurora lp-aurora-low" aria-hidden>
        <span />
        <span />
      </div>
      <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <h2 className="lp-display text-[36px] leading-[1.02] text-white sm:text-[54px]">One workspace. Every job.</h2>
          <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--lp-muted)]">
            Projects, clients, quotes, invoices, approvals and expenses, with what needs you today at the top. The same app on your phone.
          </p>
        </div>
        <div className="lp-tilt lp-light mt-14" data-reveal>
          <AppPreview />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- questions

// ---------------------------------------------------------------- blog

/** The 3 newest blog posts, for everyone who opens the site. Loaded in the browser (the section and its link are in the page from the start). */
function FromTheBlog() {
  const list = useBlogList();
  const posts = (list.data ?? []).slice(0, 3);
  return (
    <section id="blog" className="relative mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="from-the-blog" data-testid="home-blog">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--lp-glow)]">From the blog</p>
          <h2 id="from-the-blog" className="lp-display mt-3 text-[34px] leading-[1.05] text-white sm:text-[46px]">
            Pricing, clients and growth.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[var(--lp-muted)]">Fresh guides for Indian freelancers every week: market rates, strategies and success stories.</p>
        </div>
        <Link to="/blog" className={btnGhost}>
          Read the blog
        </Link>
      </div>
      <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
        {list.isPending
          ? [0, 1, 2].map((i) => <div key={i} className="h-64 rounded-3xl border border-white/[0.08] bg-[var(--lp-surface)]" aria-hidden />)
          : posts.length
            ? posts.map((p) => (
                <Link key={p.slug} to={`/blog/${p.slug}`} onPointerMove={spotlight} className="lp-tile group flex flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[var(--lp-surface)] transition-colors hover:border-white/20">
                  {p.cover_image ? <img src={p.cover_image} alt="" loading="lazy" decoding="async" className="aspect-[16/9] w-full object-cover" /> : null}
                  <span className="flex flex-1 flex-col p-6">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--lp-glow)]">{categoryOf(p.category).label}</span>
                    <span className="mt-3 text-[19px] font-semibold leading-snug text-white group-hover:underline">{p.title}</span>
                    <span className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-[var(--lp-muted)]">{p.description}</span>
                    <span className="mt-auto pt-5 text-[12px] text-[var(--lp-muted)]">{formatPostDate(p.published_at)}</span>
                  </span>
                </Link>
              ))
            : (
                <Link to="/blog" className="lp-tile rounded-3xl border border-white/[0.08] bg-[var(--lp-surface)] p-6 text-[15px] text-[var(--lp-muted)] hover:border-white/20 md:col-span-3">
                  <span className="block text-[19px] font-semibold text-white">The first posts are on their way.</span>
                  Guides on pricing, clients and growth for freelancers in India. Visit the blog →
                </Link>
              )}
      </div>
    </section>
  );
}

function Questions() {
  return (
    <section className="lp-cv border-t border-white/[0.06]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:py-28">
        <h2 className="lp-display text-[34px] leading-[1.05] text-white sm:text-[46px]" data-reveal>
          Questions freelancers ask.
        </h2>
        <div className="border-t border-white/10" data-reveal>
          {QA.map(([q, a]) => (
            <details key={q} className="lp-qa group border-b border-white/10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[16px] font-semibold text-white">
                {q}
                <svg width="18" height="18" viewBox="0 0 16 16" className="shrink-0 text-[var(--lp-muted)] transition-transform group-open:rotate-45" aria-hidden>
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="max-w-[40rem] pb-5 text-[15px] leading-relaxed text-[var(--lp-muted)]">{a}</p>
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
    <section className="px-4 py-20 sm:px-6 sm:py-24">
      <div className="lp-cta relative mx-auto max-w-6xl overflow-hidden rounded-[28px] p-px" data-reveal>
        <div className="relative overflow-hidden rounded-[27px] bg-[#0b0f18] px-6 py-16 text-center sm:px-12 sm:py-24">
          <div className="lp-floor lp-floor-cta" aria-hidden />
          <h2 className="lp-display lp-sheen relative mx-auto max-w-3xl text-[40px] leading-[1.02] sm:text-[64px]">Start your next job on the record.</h2>
          <p className="relative mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--lp-muted)]">Set up your first scope in a few minutes. Free for 2 active projects, no card needed.</p>
          <div className="relative mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className={btnPrimary}>
              Start free
            </Link>
            <Link to="/pricing" className={btnGhost}>
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
