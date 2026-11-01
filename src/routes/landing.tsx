import "@fontsource-variable/bricolage-grotesque/opsz.css";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "@/components/ui";
import { SiteFooter } from "@/components/site-footer";

/**
 * Home page. Bright and airy: soft colour washes, a large product picture with small
 * floating cards that play out ScopeFlow's core moment once, then calm feature rows.
 * Everything shown is a feature that exists today; no invented customers or numbers.
 */
export default function Landing() {
  return (
    <div className="landing min-h-dvh bg-white text-[var(--lp-ink)]">
      <AnnouncementBar />
      <Nav />
      <Hero />
      <BuiltFor />
      <Features />
      <BeforeAfter />
      <Disciplines />
      <Closing />
      <SiteFooter />
    </div>
  );
}

const btnPrimary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full bg-[var(--lp-cobalt)] px-6 py-3 text-[15px] font-semibold text-white shadow-[0_8px_24px_-10px_rgba(63,111,209,0.8)] transition hover:bg-[#3560bd]";
const btnSecondary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full bg-white px-6 py-3 text-[15px] font-semibold text-[var(--lp-ink)] ring-1 ring-[var(--lp-line)] transition hover:ring-[#c7cdd8]";

function AnnouncementBar() {
  return (
    <div className="bg-[var(--lp-ink)] px-4 py-2 text-center text-[13px] text-white/85">
      ScopeFlow is free during the beta.{" "}
      <Link to="/pricing" className="font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
        See what's included
      </Link>
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="ScopeFlow home" className="inline-flex items-center gap-2 text-[16px] font-semibold tracking-[-0.02em]">
          <svg width="24" height="24" viewBox="0 0 22 22" aria-hidden>
            <path d="M2 7V2h5M15 2h5v5M20 15v5h-5M7 20H2v-5" fill="none" stroke="var(--lp-cobalt)" strokeWidth="2" strokeLinecap="round" />
            <rect x="7" y="7" width="8" height="8" rx="1.5" fill="var(--lp-ink)" />
          </svg>
          ScopeFlow
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          <a href="#how" className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-[var(--lp-body)] hover:text-[var(--lp-ink)] md:block">
            How it works
          </a>
          <Link to="/pricing" className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-[var(--lp-body)] hover:text-[var(--lp-ink)] sm:block">
            Pricing
          </Link>
          <Link to="/login" className="whitespace-nowrap rounded-full px-3 py-2 text-[14px] font-medium text-[var(--lp-body)] hover:text-[var(--lp-ink)]">
            Sign in
          </Link>
          <Link to="/signup" className="whitespace-nowrap rounded-full bg-[var(--lp-ink)] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#1d2939]">
            Start free
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="lp-wash lp-wash-hero" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-14 text-center sm:px-6 sm:pt-20">
        <h1 className="lp-display mx-auto max-w-4xl text-[44px] leading-[1.02] sm:text-[64px] lg:text-[80px]">“Just one small change” now comes with a price.</h1>
        <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-[var(--lp-body)] sm:text-[19px]">
          ScopeFlow keeps the scope your client approved on record, checks every request against it, and turns extras into change
          orders they approve before you start.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link to="/signup" className={btnPrimary}>
            Start free
          </Link>
          <a href="#how" className={btnSecondary}>
            See how it works
          </a>
        </div>
        <p className="mt-4 text-[13px] text-[var(--lp-body)]">Free for 2 active projects. No card. Your clients never need an account.</p>
      </div>
      <HeroProduct />
    </section>
  );
}

/** Large product picture with floating cards that appear in order, once. */
function HeroProduct() {
  const [run, setRun] = useState(0);
  return (
    <div className="relative mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
      <div
        key={run}
        className="lp-stage relative mx-auto max-w-[920px]"
        role="img"
        aria-label="A ScopeFlow project: the approved scope, a client request flagged as outside scope, a priced change order approved, and the payment received"
      >
        <AppWindow />
        <Chip className="lp-c1 sm:left-[4%] sm:top-[-30px]" tone="mint" icon="check">
          <b>Approved by Meera</b>
          <span>Scope v2 locked, Tue 9:15</span>
        </Chip>
        <Chip className="lp-c2 sm:right-[4%] sm:top-[-30px]" tone="sky" icon="loop">
          <b>Revision 2 of 2 used</b>
          <span>Logo and colour palette</span>
        </Chip>
        <Chip className="lp-c3 sm:bottom-[-30px] sm:left-[3%] lg:left-[-44px]" tone="amber" icon="alert">
          <b>“Can you also do a banner?”</b>
          <span>Outside the approved scope</span>
        </Chip>
        <Chip className="lp-c4 sm:bottom-[-30px] sm:right-[3%] lg:right-[-36px]" tone="ink" icon="plus">
          <b>Change order #1 approved</b>
          <span>+₹6,000 and 2 extra days</span>
        </Chip>
      </div>
      <div className="mt-12 text-center">
        <button type="button" onClick={() => setRun((r) => r + 1)} className="text-[13px] font-medium text-[var(--lp-body)] underline-offset-4 hover:text-[var(--lp-ink)] hover:underline">
          Play again
        </button>
      </div>
    </div>
  );
}

function Chip({ className, tone, icon, children }: { className: string; tone: "mint" | "sky" | "amber" | "ink"; icon: "check" | "loop" | "alert" | "plus"; children: ReactNode }) {
  const tones = {
    mint: "bg-white text-[var(--lp-ink)] [--chip:var(--lp-mint)]",
    sky: "bg-white text-[var(--lp-ink)] [--chip:var(--lp-cobalt)]",
    amber: "bg-white text-[var(--lp-ink)] [--chip:var(--lp-amber)]",
    ink: "bg-[var(--lp-ink)] text-white [--chip:var(--lp-amber)]",
  };
  const paths = {
    check: <path d="M4 8.5 6.8 11 12 5.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    loop: <path d="M11.5 6A4 4 0 1 0 12 9M12 3.5V6.5H9" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    alert: <path d="M8 4.5v4M8 11.2v.3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />,
    plus: <path d="M8 4.5v7M4.5 8h7" fill="none" stroke="var(--lp-ink)" strokeWidth="2" strokeLinecap="round" />,
  };
  return (
    <div className={cx("lp-chip relative z-10 mt-3 flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left shadow-[0_18px_40px_-18px_rgba(16,24,40,0.45)] ring-1 ring-black/5 sm:absolute sm:mt-0", tones[tone], className)}>
      <svg width="30" height="30" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
        <rect width="16" height="16" rx="5" fill="var(--chip)" />
        {paths[icon]}
      </svg>
      <span className="grid text-[13px] leading-tight [&>b]:font-semibold [&>span]:mt-0.5 [&>span]:opacity-70">{children}</span>
    </div>
  );
}

function AppWindow() {
  return (
    <div className="overflow-hidden rounded-[22px] bg-white text-left shadow-[0_40px_90px_-40px_rgba(16,24,40,0.5)] ring-1 ring-black/5">
      <div className="flex items-center gap-1.5 border-b border-[var(--lp-line)] px-4 py-3" aria-hidden>
        <i className="size-2.5 rounded-full bg-[#f04438]/70" />
        <i className="size-2.5 rounded-full bg-[#f5a524]/70" />
        <i className="size-2.5 rounded-full bg-[#12b76a]/70" />
        <span className="ml-3 truncate rounded-md bg-[#f2f4f7] px-3 py-1 text-[11px] text-[var(--lp-body)]">scopeflow.in/projects/brand-kit</span>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1.5fr_1fr] sm:p-7 sm:pb-14 sm:pt-12">
        <div>
          <p className="text-[12px] text-[var(--lp-body)]">Chai &amp; Co.</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <p className="lp-display text-[24px] leading-tight sm:text-[28px]">Brand kit</p>
            <span className="rounded-full bg-[var(--lp-sky)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--lp-cobalt)]">In progress</span>
          </div>
          <div className="mt-5 space-y-3">
            <Row title="Logo and colour palette" used={2} of={2} />
            <Row title="Packaging label" used={1} of={1} />
            <Row title="Social templates" used={0} of={2} />
          </div>
          <div className="mt-5 rounded-xl bg-[#f9fafb] p-3.5 text-[13px]">
            <p className="font-semibold">Not included</p>
            <p className="mt-0.5 text-[var(--lp-body)]">Printing, copywriting, stock photo licences</p>
          </div>
        </div>
        <div className="rounded-2xl bg-[#f9fafb] p-4 text-[13px]">
          <p className="font-semibold">Payments</p>
          <dl className="mt-3 space-y-2 tabular-nums">
            <div className="flex justify-between">
              <dt className="text-[var(--lp-body)]">Original budget</dt>
              <dd>₹45,000</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--lp-body)]">Approved changes</dt>
              <dd>+₹6,000</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--lp-line)] pt-2 font-semibold">
              <dt>Contract total</dt>
              <dd>₹51,000</dd>
            </div>
          </dl>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--lp-line)]">
            <div className="lp-paid h-full w-1/2 rounded-full bg-[var(--lp-mint)]" />
          </div>
          <p className="mt-2 text-[12px] text-[var(--lp-body)]">₹25,500 received of ₹51,000</p>
          <ul className="mt-4 space-y-2">
            <li className="flex items-center justify-between">
              <span>50% advance</span>
              <span className="rounded-full bg-[var(--lp-mint-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#067647]">Paid</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Final delivery</span>
              <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11px] font-semibold text-[var(--lp-body)]">Due Nov 30</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ title, used, of }: { title: string; used: number; of: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[14px]">
      <span>{title}</span>
      <span className="flex items-center gap-2">
        <span className="hidden gap-1 sm:flex" aria-hidden>
          {Array.from({ length: of }, (_, i) => (
            <i key={i} className={cx("h-1.5 w-5 rounded-full", i < used ? (used >= of ? "bg-[var(--lp-amber)]" : "bg-[var(--lp-cobalt)]") : "bg-[var(--lp-line)]")} />
          ))}
        </span>
        <span className="whitespace-nowrap text-[12px] tabular-nums text-[var(--lp-body)]">
          {used} of {of} rounds
        </span>
      </span>
    </div>
  );
}

const WHO = ["Graphic designers", "Brand studios", "Web developers", "UI/UX designers", "Video editors", "Social media marketers", "Illustrators", "Copywriters", "Photographers", "Consultants"];

function BuiltFor() {
  return (
    <section className="border-y border-[var(--lp-line)] py-7" aria-label="Who ScopeFlow is for">
      <p className="text-center text-[13px] font-medium text-[var(--lp-body)]">Made for independent creatives and small studios</p>
      <div className="lp-marquee mt-4 overflow-hidden">
        <ul className="lp-marquee-track flex w-max gap-3">
          {[...WHO, ...WHO].map((w, i) => (
            <li key={i} aria-hidden={i >= WHO.length} className="whitespace-nowrap rounded-full bg-[#f9fafb] px-4 py-2 text-[14px] font-medium ring-1 ring-[var(--lp-line)]">
              {w}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 space-y-24 px-4 py-24 sm:px-6 lg:space-y-32 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="lp-display text-[36px] leading-[1.05] sm:text-[52px]">Agree once. Point to it every time.</h2>
        <p className="mt-5 text-[17px] leading-relaxed text-[var(--lp-body)]">Three steps that take the awkwardness out of “that wasn't part of the deal”.</p>
      </div>
      <FeatureRow
        wash="sky"
        title="Send a scope your client actually reads"
        body="List the deliverables, how many revision rounds each includes, what's not included and your payment terms. Your client opens one private link on their phone and approves it — no account, no app."
        points={["Scope check flags vague words like “etc.” before you send", "Each approved version is locked and fingerprinted"]}
        visual={<ApproveVisual />}
      />
      <FeatureRow
        flip
        wash="butter"
        title="Every request is checked against it"
        body="When your client asks for a revision, ScopeFlow counts it against the rounds they approved. Anything beyond those rounds, or outside the deliverables, is flagged the moment it arrives."
        points={["Clients see how many rounds are left, and what an extra one costs", "You decide: do it anyway, or price it"]}
        visual={<RequestVisual />}
      />
      <FeatureRow
        wash="mint"
        title="Extras become priced change orders"
        body="Price extra work as fixed or hourly, add the days it needs, and send it. When your client approves, the budget, due date and payment schedule update on their own."
        points={["Mark payments received and see what's overdue", "Everything lands in one timeline you can both see"]}
        visual={<ChangeOrderVisual />}
      />
    </section>
  );
}

function FeatureRow({ title, body, points, visual, flip, wash }: { title: string; body: string; points: string[]; visual: ReactNode; flip?: boolean; wash: "sky" | "butter" | "mint" }) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cx(flip && "lg:order-2")}>
        <h3 className="lp-display text-[30px] leading-[1.08] sm:text-[38px]">{title}</h3>
        <p className="mt-4 text-[17px] leading-relaxed text-[var(--lp-body)]">{body}</p>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-[15px]">
              <svg width="20" height="20" viewBox="0 0 20 20" className="mt-0.5 shrink-0" aria-hidden>
                <circle cx="10" cy="10" r="10" fill="var(--lp-sky)" />
                <path d="M6 10.4 8.6 13 14 7.5" fill="none" stroke="var(--lp-cobalt)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={cx("lp-panel relative overflow-hidden rounded-[32px] p-6 sm:p-10", `lp-panel-${wash}`)}>
        <div className="relative">{visual}</div>
      </div>
    </div>
  );
}

function ApproveVisual() {
  return (
    <div className="mx-auto max-w-[360px] rounded-3xl bg-white p-5 shadow-[0_24px_50px_-28px_rgba(16,24,40,0.45)]">
      <p className="text-[12px] text-[var(--lp-body)]">Raman Studio, for Chai &amp; Co.</p>
      <p className="lp-display mt-1 text-[22px]">Brand kit</p>
      <ul className="mt-4 space-y-2.5 text-[13px]">
        <li className="flex justify-between">
          <span>Logo and colour palette</span>
          <span className="text-[var(--lp-body)]">2 rounds</span>
        </li>
        <li className="flex justify-between">
          <span>Packaging label</span>
          <span className="text-[var(--lp-body)]">1 round</span>
        </li>
        <li className="flex justify-between text-[var(--lp-body)]">
          <span>Not included</span>
          <span>Printing</span>
        </li>
      </ul>
      <div className="mt-5 flex items-baseline justify-between border-t border-[var(--lp-line)] pt-3 text-[13px]">
        <span className="text-[var(--lp-body)]">Total</span>
        <span className="lp-display text-[22px]">₹45,000</span>
      </div>
      <div className="mt-4 rounded-full bg-[var(--lp-cobalt)] py-2.5 text-center text-[14px] font-semibold text-white">Approve scope</div>
    </div>
  );
}

function RequestVisual() {
  return (
    <div className="mx-auto max-w-[380px] space-y-3">
      <Bubble text="Could we try the logo in navy?" tag="Included, round 2 of 2" tone="sky" />
      <Bubble text="One more round with a rounder cup icon?" tag="Beyond the 2 rounds included" tone="amber" />
      <Bubble text="Can you also do a website banner?" tag="Outside the approved scope" tone="amber" />
    </div>
  );
}

function Bubble({ text, tag, tone }: { text: string; tag: string; tone: "sky" | "amber" }) {
  return (
    <div className="rounded-2xl rounded-tl-md bg-white p-4 shadow-[0_18px_40px_-26px_rgba(16,24,40,0.5)]">
      <p className="text-[12px] text-[var(--lp-body)]">Meera</p>
      <p className="mt-0.5 text-[14px]">{text}</p>
      <span className={cx("mt-2.5 inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold", tone === "sky" ? "bg-[var(--lp-sky)] text-[var(--lp-cobalt)]" : "bg-[#fef0c7] text-[#93370d]")}>{tag}</span>
    </div>
  );
}

function ChangeOrderVisual() {
  return (
    <div className="mx-auto max-w-[360px] rounded-3xl bg-white p-5 shadow-[0_24px_50px_-28px_rgba(16,24,40,0.45)]">
      <p className="text-[12px] text-[var(--lp-body)]">Change order #1</p>
      <p className="mt-0.5 text-[16px] font-semibold">Website banner, 3 sizes</p>
      <dl className="mt-4 space-y-2 text-[13px] tabular-nums">
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">Price</dt>
          <dd className="font-semibold">₹6,000</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">Extra time</dt>
          <dd>2 days</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--lp-body)]">New due date</dt>
          <dd>Nov 30</dd>
        </div>
        <div className="flex justify-between border-t border-[var(--lp-line)] pt-2 font-semibold">
          <dt>New contract total</dt>
          <dd>₹51,000</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--lp-mint-soft)] px-3 py-2 text-[13px] font-semibold text-[#067647]">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 8.5 6.8 11 12 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Approved by Meera, Fri 11:05
      </div>
    </div>
  );
}

function BeforeAfter() {
  const without = [
    "The scope lives in a WhatsApp thread nobody can find",
    "“Small changes” pile up and eat your weekends",
    "Asking for more money feels awkward",
    "Payments slip because nobody tracks the dates",
  ];
  const withSf = [
    "One approved, locked scope you can both point to",
    "Every request counted against the rounds agreed",
    "Extras arrive as change orders with a price",
    "Milestones, due dates and what's overdue in one place",
  ];
  return (
    <section className="bg-[#f9fafb] py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="lp-display mx-auto max-w-3xl text-center text-[36px] leading-[1.05] sm:text-[52px]">The difference shows up on your first project.</h2>
        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[28px] bg-white p-7 ring-1 ring-[var(--lp-line)] sm:p-9">
            <h3 className="text-[18px] font-semibold text-[var(--lp-body)]">Without ScopeFlow</h3>
            <ul className="mt-6 space-y-4">
              {without.map((t) => (
                <li key={t} className="flex gap-3 text-[16px] text-[var(--lp-body)]">
                  <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0" aria-hidden>
                    <circle cx="11" cy="11" r="11" fill="#f2f4f7" />
                    <path d="M7.5 7.5l7 7M14.5 7.5l-7 7" stroke="#98a2b3" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-panel lp-panel-mint relative overflow-hidden rounded-[28px] p-7 sm:p-9">
            <h3 className="relative text-[18px] font-semibold">With ScopeFlow</h3>
            <ul className="relative mt-6 space-y-4">
              {withSf.map((t) => (
                <li key={t} className="flex gap-3 text-[16px]">
                  <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0" aria-hidden>
                    <circle cx="11" cy="11" r="11" fill="var(--lp-mint)" />
                    <path d="M6.8 11.4 9.6 14.2 15.2 8.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const EXAMPLES: { id: string; label: string; title: string; items: [string, string][]; not: string }[] = [
  { id: "design", label: "Design", title: "Brand identity", items: [["Logo, colour and mono versions", "2 rounds"], ["Colour palette and type", "1 round"], ["10-page brand guide", "1 round"]], not: "Trademark registration, website design, font licences" },
  { id: "web", label: "Websites", title: "Marketing website", items: [["Designs for up to 5 pages", "2 rounds"], ["Responsive build", "1 round"], ["Launch and basic SEO", "No rounds"]], not: "Hosting and domain fees, copywriting, ongoing maintenance" },
  { id: "video", label: "Video", title: "Launch video", items: [["3-minute main edit", "2 rounds"], ["3 vertical social clips", "1 round"]], not: "Filming, voice-over artists, premium stock footage" },
  { id: "social", label: "Social media", title: "Monthly content", items: [["Content calendar for 2 channels", "1 round"], ["12 post designs and captions", "2 rounds"], ["Monthly report", "No rounds"]], not: "Paid ad spend, community replies, influencer fees" },
];

function Disciplines() {
  const [tab, setTab] = useState(EXAMPLES[0].id);
  const ex = EXAMPLES.find((e) => e.id === tab)!;
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 className="lp-display text-[36px] leading-[1.05] sm:text-[48px]">However you work, the scope is clear.</h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-[var(--lp-body)]">
            Deliverables with their own revision rounds, and a plain list of what's not included. Here's what a scope looks like for
            different kinds of work.
          </p>
          <div role="tablist" aria-label="Kinds of work" className="mt-8 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e.id}
                role="tab"
                type="button"
                aria-selected={tab === e.id}
                aria-controls="lp-example"
                onClick={() => setTab(e.id)}
                className={cx("rounded-full px-4 py-2 text-[14px] font-semibold transition", tab === e.id ? "bg-[var(--lp-ink)] text-white" : "bg-[#f2f4f7] hover:bg-[#eaecf0]")}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
        <div id="lp-example" role="tabpanel" className="lp-panel lp-panel-sky relative overflow-hidden rounded-[32px] p-6 sm:p-10">
          <div className="relative rounded-3xl bg-white p-6 shadow-[0_24px_50px_-28px_rgba(16,24,40,0.45)]">
            <p className="lp-display text-[24px]">{ex.title}</p>
            <ul className="mt-4 divide-y divide-[var(--lp-line)] text-[14px]">
              {ex.items.map(([t, r]) => (
                <li key={t} className="flex justify-between gap-4 py-3">
                  <span>{t}</span>
                  <span className="whitespace-nowrap text-[var(--lp-body)]">{r}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-xl bg-[#f9fafb] p-3.5 text-[13px]">
              <p className="font-semibold">Not included</p>
              <p className="mt-0.5 text-[var(--lp-body)]">{ex.not}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="px-4 pb-16 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[36px] bg-[var(--lp-ink)] px-6 py-16 text-center text-white sm:px-14 sm:py-24">
        <div className="lp-wash lp-wash-dark" aria-hidden />
        <h2 className="lp-display relative mx-auto max-w-3xl text-[38px] leading-[1.03] sm:text-[60px]">Stop doing extra work for free.</h2>
        <p className="relative mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-white/80">
          Free for 2 active projects at a time, with every core feature. Set up your first scope in minutes.
        </p>
        <div className="relative mt-9 flex flex-wrap justify-center gap-3">
          <Link to="/signup" className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-[15px] font-semibold text-[var(--lp-ink)] hover:bg-white/90">
            Start free
          </Link>
          <Link to="/pricing" className="inline-flex items-center justify-center rounded-full px-6 py-3 text-[15px] font-semibold text-white ring-1 ring-white/35 hover:ring-white/70">
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
