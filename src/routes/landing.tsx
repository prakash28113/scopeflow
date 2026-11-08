import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { cx } from "@/components/ui";
import { PublicHeader } from "@/components/public-header";
import { LogoFull } from "@/components/brand";
import { HOME_FAQ, HOME_FAQ_EARLY } from "@/lib/faq";
import { useSeo } from "@/lib/seo";
import { useBlogList } from "@/lib/blog";
import { categoryOf, formatPostDate } from "@/lib/blog-content";
import { INSTAGRAM_URL, OPERATOR_CITY, OPERATOR_NAME, SUPPORT_EMAIL, supportMailto } from "@/lib/site";

/**
 * Home page (V3): floating cards on near-black, large tight type, low-key photography, real product
 * screens. Photos come from public/home (made for ScopeFlow; screens composited from the real app with
 * a fictional demo workspace). Every claim is true today; AI suggestions are marked as early access.
 * Motion is CSS-only, subtle, and stops with reduced motion.
 */
export default function Landing() {
  useSeo("/");
  useReveal();
  return (
    <div className="hm min-h-dvh overflow-x-clip">
      <PublicHeader tone="dark" floating />
      <main>
        <Hero />
        <Manifesto />
        <MadeFor />
        <Screens />
        <Ai />
        <Tour />
        <Handles />
        <Values />
        <Heard />
        <FromTheBlog />
        <Questions />
        <Start />
      </main>
      <Footer />
    </div>
  );
}

/** Adds data-in to [data-reveal] elements once they reach the lower part of the screen (CSS animates). */
function useReveal() {
  useEffect(() => {
    let pending = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    let frame = 0;
    const check = () => {
      frame = 0;
      const limit = window.innerHeight * 0.92;
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

const H = "/home/";
/** A photo with a small and a large WebP; below-the-fold photos load lazily. */
function Photo({ name, sizes = "(min-width: 1400px) 1336px, (min-width: 1024px) calc(100vw - 64px), 100vw", widths = [640, 1024], w, h, alt, className, style, eager }: { name: string; sizes?: string; widths?: number[]; w: number; h: number; alt: string; className?: string; style?: CSSProperties; eager?: boolean }) {
  const largest = widths[widths.length - 1];
  return (
    <img
      src={`${H}${name}-${largest}.webp`}
      srcSet={widths.length > 1 ? widths.map((x) => `${H}${name}-${x}.webp ${x}w`).join(", ") : undefined}
      sizes={widths.length > 1 ? sizes : undefined}
      width={w}
      height={h}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding={eager ? "sync" : "async"}
      fetchPriority={eager ? "high" : undefined}
      className={className}
      style={style}
    />
  );
}

const pill = "hm-pill";
const ghost = "hm-ghost";

// ---------------------------------------------------------------- hero

function Hero() {
  return (
    <section id="top" className="hm-wrap pt-12 sm:pt-24">
      <div className="mx-auto flex max-w-[1060px] flex-col items-center gap-6 text-center">
        <h1 className="hm-h1 hm-rise">ScopeFlow — stop scope creep before it turns into unpaid work</h1>
        <p className="hm-lede hm-rise hm-r2" data-testid="hero-subline">
          Define the scope, track every revision, catch extra requests and get paid for them. For freelancers and creative agencies in India.
        </p>
        <div className="hm-rise hm-r3 mt-1 flex flex-wrap justify-center gap-3">
          <Link to="/signup" className={pill}>
            Start free
          </Link>
          <a href="#tour" className={ghost}>
            Watch the tour
          </a>
        </div>
        <p className="hm-rise hm-r4 text-[14px] text-[var(--hm-faint)]">Free for 2 active projects · No card needed · Clients never need an account</p>
      </div>

      <div className="hm-card hm-hero-card mt-10 sm:mt-14">
        <Photo name="hero-stamp" w={1024} h={683} eager alt="A hand pressing a wooden stamp onto a sheet of paper in a single beam of warm light" className="hm-kb absolute inset-0 size-full object-cover" style={{ objectPosition: "60% 50%" }} />
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3.5">
        <div className="hm-card hm-tile" role="img" aria-label="A figure raising a hand: stop work that wasn't agreed">
          <svg className="hm-bob hm-tile-picto" viewBox="0 0 64 64" aria-hidden>
            <circle cx="30" cy="9" r="7" fill="#fff" />
            <path d="M30 21 V40 M30 40 L22 59 M30 40 L38 59 M30 26 L45 15 M30 26 L17 34" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="50" cy="10" r="6.5" fill="#fff" />
          </svg>
        </div>
        <div className="hm-card hm-tile hm-halftone" role="img" aria-label="Clearer, fairer, calmer, paid">
          <div className="hm-roll" aria-hidden>
            <div className="hm-roll-win">
              <div className="hm-roll-track">
                {["Paid", "Clearer", "Fairer", "Calmer", "Paid"].map((w, i) => (
                  <span key={i}>{w}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hm-card hm-dots mt-3.5 px-4 py-10 sm:py-14">
        <DotWordmark />
      </div>
    </section>
  );
}

/** "SCOPEFLOW" in a 5×7 dot-matrix, drawn as SVG (no font to load). Letters light up in turn. */
const GLYPHS: Record<string, string[]> = {
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
};
function DotWordmark() {
  const word = "SCOPEFLOW";
  return (
    <svg viewBox={`-0.5 -0.5 ${word.length * 6 - 1} 7`} className="mx-auto block w-full max-w-[1000px]" role="img" aria-label="ScopeFlow">
      {word.split("").map((ch, li) => (
        <g key={li} className="hm-scan" style={{ animationDelay: `${(li * 0.32).toFixed(2)}s` }}>
          {GLYPHS[ch].flatMap((row, y) =>
            row.split("").map((c, x) => (c === "#" ? <circle key={`${x}-${y}`} cx={li * 6 + x} cy={y} r={0.4} fill="#ecece6" /> : null)),
          )}
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- manifesto + who it's for

const MANIFESTO = "Stopping scope creep before it becomes unpaid work, so every change is agreed, every revision is counted, and every extra gets paid";
const HOT = new Set(["unpaid", "work,", "paid"]);

function Manifesto() {
  return (
    <section className="hm-wrap hm-sec" aria-label="Why ScopeFlow exists">
      <p className="hm-mani mx-auto max-w-[1100px]">
        {MANIFESTO.split(" ").map((t, i) => (
          <span key={i} className={cx("hm-w", HOT.has(t.toLowerCase()) && "hm-hot")}>
            {t}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}

const MADE_FOR = ["Brand designers", "Video editors", "Web developers", "Photographers", "Copywriters", "Social media managers", "Studios and agencies"];

function MadeFor() {
  return (
    <section className="hm-sec" aria-labelledby="made-for">
      <div className="hm-wrap">
        <h2 id="made-for" className="max-w-[30ch] text-[clamp(20px,2.6vw,26px)] font-normal leading-[1.3] tracking-[-0.03em] [text-wrap:balance]">
          Made for the people who make things, and get asked for “one more”
        </h2>
      </div>
      <div className="hm-marquee mt-10 sm:mt-12">
        <ul className="hm-marquee-track" aria-label={MADE_FOR.join(", ")}>
          {[...MADE_FOR, ...MADE_FOR].map((t, i) => (
            <li key={i} className="hm-chip-tile" aria-hidden={i >= MADE_FOR.length || undefined}>
              <i aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the real screens

const SCREENS: { name: string; line: string; photo: string; widths: number[]; pw: number; ph: number; pos: string; mpos: string; alt: string; ui: string; uh: number; uiAlt: string; tags: string[] }[] = [
  {
    name: "Overview",
    line: "What's in progress, what's waiting on clients, what's unpaid, and anything outside the approved scope.",
    photo: "show-overview", widths: [640, 1024], pw: 1024, ph: 579, pos: "50% 46%", mpos: "50% 50%",
    alt: "A laptop on a black stone plinth showing the ScopeFlow overview",
    ui: "ui-overview-m", uh: 1100,
    uiAlt: "The overview on a phone: 2 projects in progress, 1 waiting for approval, ₹55,410 contract unpaid, ₹66,130 collected, and an alert that 3 client requests are outside the approved scope",
    tags: ["Daily view", "Reminders", "Alerts"],
  },
  {
    name: "Project & revisions",
    line: "Each deliverable counts its revision rounds. Go past the limit and ScopeFlow flags the extra.",
    photo: "show-project", widths: [640, 1024], pw: 1024, ph: 579, pos: "50% 30%", mpos: "50% 30%",
    alt: "A laptop on a black ring sculpture showing a ScopeFlow project",
    ui: "ui-revisions-m", uh: 810,
    uiAlt: "A project's approved scope: the primary logo has used both of its 2 revision rounds, plus 1 extra",
    tags: ["Scope", "Revisions", "Progress"],
  },
  {
    name: "Client page",
    line: "Your client opens one private link to approve, ask for changes and see what's paid. No account.",
    photo: "slide-whatsapp", widths: [1024], pw: 1024, ph: 768, pos: "45% 35%", mpos: "40% 40%",
    alt: "A client in a café looking at her ScopeFlow project page on a phone",
    ui: "ui-client-m", uh: 820,
    uiAlt: "The client's project page: project total ₹61,360, paid ₹25,420 and due 23 November",
    tags: ["Phone", "No login", "Approvals"],
  },
  {
    name: "Quote & GST",
    line: "Fixed, hourly or per-unit lines with GST, a quote number and a printable PDF.",
    photo: "show-quote", widths: [640, 1024], pw: 1024, ph: 579, pos: "50% 50%", mpos: "38% 50%",
    alt: "A printed ScopeFlow quote on cream paper beside a phone, on a charcoal desk",
    ui: "ui-quote-m", uh: 667,
    uiAlt: "A quote: primary logo ₹20,000, colour and type system ₹8,000, menu boards, brand guide, GST at 18% and a total of ₹54,280",
    tags: ["Quote number", "GST", "PDF"],
  },
];

/** Each screen as a scene (photo) beside the real screen at phone size, so it stays readable at every width. */
function Screens() {
  return (
    <section id="product" className="hm-wrap hm-sec scroll-mt-24">
      <div className="mb-12 flex flex-wrap items-end justify-between gap-5 sm:mb-16">
        <h2 className="hm-h3 max-w-[22ch]">A look at the screens that do the work</h2>
        <Link to="/signup" className="hm-arrow-link">
          Start free
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 3l12 9-12 9 3-9z" />
          </svg>
        </Link>
      </div>
      <div className="flex flex-col gap-24 md:gap-28">
        {SCREENS.map((s, i) => (
          <article key={s.name} className={cx("hm-screen", i % 2 === 1 && "hm-screen-flip")} data-reveal>
            <div className="hm-shot" style={{ "--mpos": s.mpos, "--pos": s.pos } as CSSProperties}>
              <Photo name={s.photo} widths={s.widths} sizes="(min-width: 1024px) 66vw, 100vw" w={s.pw} h={s.ph} alt={s.alt} className="size-full object-cover" />
            </div>
            <figure className="hm-ui">
              <img src={`${H}${s.ui}-780.webp`} width={780} height={s.uh} alt={s.uiAlt} loading="lazy" decoding="async" />
            </figure>
            <div className="hm-screen-text">
              <h3 className="hm-name">{s.name}</h3>
              <p className="mt-2 max-w-[34rem] text-[16px] leading-relaxed text-[var(--hm-muted)]">{s.line}</p>
              <ul className="hm-tags">
                {s.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
      <p className="mt-16 text-[13px] text-[var(--hm-faint)]">Real ScopeFlow screens. Raman Studio and its clients are a fictional demo workspace.</p>
    </section>
  );
}

// ---------------------------------------------------------------- AI, in early access

const AI_FEATURES: { n: string; title: string; body: string; points: string[]; img: string; iw: number; ih: number; mimg?: string; mw?: number; mh?: number; alt: string }[] = [
  {
    n: "01",
    title: "Describe a job. Get a structured scope.",
    body: "Write the project the way you'd explain it to a friend. ScopeFlow suggests deliverables, revision rounds, what's not included, what you need from the client, risks and the questions to settle.",
    points: ["Untick anything you don't want", "Prices only when you give them", "Copied into the form; you still save it"],
    img: "ai-draft-1200",
    iw: 1200,
    ih: 1281,
    mimg: "ai-draft-m-800",
    mw: 800,
    mh: 1788,
    alt: "Describe the project: a description of a café brand kit, and the suggested scope with deliverables, revision rounds and what's not included",
  },
  {
    n: "02",
    title: "Every request, checked against what was approved.",
    body: "Paste what the client asked for, or open a logged request. ScopeFlow says whether it's covered, uses a revision round or is new work, what it would cost at your own saved prices, and drafts a reply.",
    points: ["Spots work outside the scope", "Explains the timeline impact", "Drafts the change order for you to send"],
    img: "ai-impact-1000",
    iw: 1000,
    ih: 1349,
    mimg: "ai-impact-m-800",
    mw: 800,
    mh: 1600,
    alt: "A client asks for a 15-second video ad: marked as new work that needs a change order, with no saved price, the timeline impact, questions for the client and a reply to send",
  },
  {
    n: "03",
    title: "Ask about your projects in plain words.",
    body: "“What's waiting on me?” “Who owes me money?” “Draft a payment reminder.” Answers come only from your own ScopeFlow data, with buttons that open the right screen.",
    points: ["Knows the project you're in", "Shows what each answer is based on", "Never changes anything by itself"],
    img: "ai-assistant-1600",
    iw: 1600,
    ih: 575,
    mimg: "ai-assistant-m-800",
    mw: 800,
    mh: 1180,
    alt: "Asked what's waiting, the assistant lists three client requests that need a decision and one scope still with a client, with buttons to open approvals and draft a change order",
  },
];

function Ai() {
  return (
    <section id="ai" className="hm-wrap hm-sec scroll-mt-24" aria-labelledby="ai-title">
      <div className="mx-auto flex max-w-[900px] flex-col items-center gap-5 text-center">
        <p className="hm-badge">
          <span aria-hidden />
          Early access
        </p>
        <h2 id="ai-title" className="hm-h2">
          AI that works inside
          <br />
          the project
        </h2>
        <p className="hm-lede">Not a chat window in the corner. Three assistants built into the screens you already use, each one a suggestion you review before anything changes.</p>
      </div>
      <div className="mt-16 flex flex-col gap-20 sm:mt-20 lg:gap-28">
        {AI_FEATURES.map((f, i) => (
          <article
            key={f.n}
            className={cx(
              "grid grid-cols-1 items-center gap-8 lg:gap-14",
              // The assistant's answer is a wide screen: text above it, the screen at full width.
              f.iw > f.ih * 2 ? "lg:gap-10" : i % 2 === 1 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]",
            )}
            data-reveal
          >
            <div className={cx("flex flex-col gap-4", f.iw > f.ih * 2 ? "max-w-[46rem]" : i % 2 === 1 && "lg:order-2")}>
              <p className="text-[14px] font-medium tabular-nums text-[var(--hm-orange)]">{f.n}</p>
              <h3 className="hm-h3">{f.title}</h3>
              <p className="text-[17px] leading-relaxed tracking-[-0.01em] text-[var(--hm-muted)]">{f.body}</p>
              <ul className="mt-1 flex flex-col gap-2.5 text-[15px] text-[var(--hm-text)]">
                {f.points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5">
                    <svg width="18" height="18" viewBox="0 0 24 24" className="mt-[3px] shrink-0 text-[var(--hm-blue)]" fill="currentColor" aria-hidden>
                      <path d="M12 1 C12.9 8.2 15.8 11.1 23 12 C15.8 12.9 12.9 15.8 12 23 C11.1 15.8 8.2 12.9 1 12 C8.2 11.1 11.1 8.2 12 1 Z" />
                    </svg>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hm-ai-frame">
              <picture>
                {f.mimg ? <source media="(max-width: 767px)" srcSet={`${H}${f.mimg}.webp`} width={f.mw} height={f.mh} /> : null}
                <img src={`${H}${f.img}.webp`} width={f.iw} height={f.ih} alt={f.alt} loading="lazy" decoding="async" />
              </picture>
            </div>
          </article>
        ))}
      </div>
      <ul className="mx-auto mt-20 grid max-w-[1000px] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="How AI suggestions behave">
        {["You edit everything it suggests", "Nothing changes until you confirm", "It never makes up prices or dates", "Your projects stay private to you"].map((t) => (
          <li key={t} className="hm-card px-5 py-4 text-[15px] leading-snug text-[var(--hm-text)]">
            {t}
          </li>
        ))}
      </ul>
      <p className="mx-auto mt-8 max-w-[46rem] text-center text-[13px] leading-relaxed text-[var(--hm-faint)]">
        AI suggestions are in early access and reach accounts gradually. The screens show ScopeFlow's real interface with example answers and the fictional demo workspace. Scope checks, revision limits and change orders work without AI.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- product tour

function Tour() {
  const box = useRef<HTMLDivElement>(null);
  // The posters load only when the tour is a screen or two away, not with the first screen.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    if (!("IntersectionObserver" in window)) return setNear(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setNear(true), io.disconnect()), { rootMargin: "1200px 0px" });
    io.observe(root);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const root = box.current;
    if (!root || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Two cuts of the same tour: phone screens on phones, desktop screens from 640px. Only the visible one plays.
    const videos = [...root.querySelectorAll("video")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          v.muted = true;
          if (e.isIntersecting) v.play().catch(() => {});
          else v.pause();
        }
      },
      { threshold: 0.45 },
    );
    videos.forEach((v) => io.observe(v));
    return () => io.disconnect();
  }, []);
  return (
    <section id="tour" className="hm-wrap hm-sec scroll-mt-24" aria-labelledby="tour-title">
      <h2 id="tour-title" className="hm-h2 mb-12 text-center sm:mb-14" data-reveal>
        See one job,
        <br />
        start to paid
      </h2>
      <div ref={box} className="hm-card mx-auto max-w-[460px] overflow-hidden bg-[#f4f5f7] sm:max-w-none" data-reveal>
        <video className="block aspect-[4/5] w-full sm:hidden" src={`${H}scopeflow-tour-m.mp4`} poster={near ? `${H}tour-poster-m-720.webp` : undefined} preload="none" muted loop playsInline controls aria-label="ScopeFlow product tour on a phone, 23 seconds, no sound" />
        <video className="hidden aspect-[16/10] w-full sm:block" src={`${H}scopeflow-tour.mp4`} poster={near ? `${H}tour-poster-1440.webp` : undefined} preload="none" muted loop playsInline controls aria-label="ScopeFlow product tour, 26 seconds, no sound" />
      </div>
      <p className="mx-auto mt-4 max-w-[40rem] text-center text-[13px] text-[var(--hm-faint)]">No sound · the overview, scope and revisions, a request outside the scope, the quote and the client's page · fictional demo workspace</p>
    </section>
  );
}

// ---------------------------------------------------------------- what it handles (carousel)

const SLIDES: { label: string; body: string; img: string; w: number; h: number; pos: string; alt: string }[] = [
  { label: "Client approval", body: "One private link. Approved versions are locked.", img: "slide-approval-800", w: 800, h: 800, pos: "40% 60%", alt: "A cobalt tick stamp pressed on paper" },
  { label: "Revision tracking", body: "Rounds counted per deliverable, extras flagged.", img: "slide-revisions-600", w: 600, h: 800, pos: "45% 50%", alt: "A phone on an orange surface showing the ScopeFlow overview" },
  { label: "Change orders", body: "Extra work priced and approved before it starts.", img: "slide-change-1024", w: 1024, h: 579, pos: "70% 50%", alt: "Paper, a cobalt pen and a phone on linen" },
  { label: "GST invoices", body: "From any payment, with your UPI QR code.", img: "slide-invoices-1024", w: 1024, h: 768, pos: "45% 50%", alt: "A phone on a stack of cream paper in warm light" },
  { label: "WhatsApp requests", body: "Log what came by chat or call. Same scope checks.", img: "show-client-600", w: 600, h: 800, pos: "50% 50%", alt: "A phone on an orange ribbed surface showing a client's request form" },
  { label: "Payments", body: "Part payments, balances and what's overdue.", img: "slide-payments-1024", w: 1024, h: 439, pos: "62% 50%", alt: "A desk facing the city at blue hour" },
];

function Handles() {
  const track = useRef<HTMLUListElement>(null);
  // Slides sit side by side in a scroller, so the browser's lazy loading would wait for each swipe.
  // Load them all once the carousel comes near instead.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const loadAll = () => el.querySelectorAll("img").forEach((img) => (img.loading = "eager"));
    if (!("IntersectionObserver" in window)) return loadAll();
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          loadAll();
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const step = (dir: number) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector("li");
    el.scrollBy({ left: dir * ((card?.clientWidth ?? 300) + 20), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return (
    <section id="how" className="hm-sec scroll-mt-24" aria-labelledby="how-title">
      <h2 id="how-title" className="hm-h2 hm-wrap mb-12 text-center sm:mb-16" data-reveal>
        What ScopeFlow
        <br />
        handles
      </h2>
      <ul ref={track} className="hm-carousel" aria-label="What ScopeFlow handles" tabIndex={0}>
        {SLIDES.map((s) => (
          <li key={s.label} className="hm-slide">
            <p className="hm-slide-label">{s.label}</p>
            <div className="hm-card hm-slide-card">
              <img src={`${H}${s.img}.webp`} width={s.w} height={s.h} alt={s.alt} loading="lazy" decoding="async" className="size-full object-cover" style={{ objectPosition: s.pos }} />
            </div>
            <p className="max-w-[30ch] text-center text-[15px] leading-snug text-[var(--hm-muted)]">{s.body}</p>
          </li>
        ))}
      </ul>
      <div className="hm-wrap mt-8 flex justify-center gap-3.5">
        <button type="button" className="hm-round" onClick={() => step(-1)} aria-label="Previous">
          <Chevron dir="left" />
        </button>
        <button type="button" className="hm-round" onClick={() => step(1)} aria-label="Next">
          <Chevron dir="right" />
        </button>
      </div>
    </section>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

// ---------------------------------------------------------------- values

function Pictogram({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className="hm-picto">
      {children}
    </svg>
  );
}
const stroke = { stroke: "#fff", strokeWidth: 8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

function Values() {
  return (
    <section className="hm-wrap hm-sec flex flex-col items-center gap-10" aria-labelledby="values-title">
      <h2 id="values-title" className="max-w-[20ch] text-center text-[clamp(30px,4.2vw,48px)] font-normal leading-[1.1] tracking-[-0.045em]" data-reveal>
        We choose clarity over awkward conversations
      </h2>
      <div className="hm-glass">
        <Photo name="glass-mark" widths={[520, 800]} sizes="(min-width: 640px) 520px, 84vw" w={800} h={800} alt="A hand holding up a glowing glass tile with the ScopeFlow mark" className="size-full object-cover" />
      </div>
      <ul className="grid w-full max-w-[780px] grid-cols-2 gap-x-5 gap-y-14 md:grid-cols-4">
        <li className="hm-value">
          <Pictogram>
            <circle cx="20" cy="9" r="7" fill="#fff" />
            <path d="M20 21 V40 M20 40 L12 58 M20 40 L28 58 M20 27 L35 32" {...stroke} />
            <rect x="37" y="14" width="21" height="29" rx="3" fill="#fff" />
            <path d="M42 23 H53 M42 29 H53 M42 35 H48" stroke="#0e0e0e" strokeWidth="3" strokeLinecap="round" />
          </Pictogram>
          Write it down
        </li>
        <li className="hm-value">
          <Pictogram>
            <circle cx="30" cy="9" r="7" fill="#fff" />
            <path d="M30 21 V40 M30 40 L22 58 M30 40 L38 58 M30 26 L45 16 M30 26 L17 34" {...stroke} />
            <circle cx="50" cy="11" r="6" fill="#fff" />
          </Pictogram>
          Ask before extra
        </li>
        <li className="hm-value">
          <Pictogram>
            <circle cx="15" cy="10" r="7" fill="#fff" />
            <circle cx="49" cy="10" r="7" fill="#fff" />
            <path d="M15 22 V41 M15 41 L9 58 M15 41 L21 58 M49 22 V41 M49 41 L43 58 M49 41 L55 58 M15 28 L32 35 L49 28" {...stroke} />
          </Pictogram>
          No surprises
        </li>
        <li className="hm-value">
          <Pictogram>
            <circle cx="30" cy="17" r="7" fill="#fff" />
            <path d="M30 28 V42 M30 42 L20 57 M30 42 L40 57 M30 32 L16 22 M30 32 L44 22" {...stroke} />
            <circle cx="52" cy="10" r="7" fill="none" stroke="#fff" strokeWidth="4" />
            <path d="M52 6 V14" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
          </Pictogram>
          Get paid properly
        </li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- heard this before?

const HEARD: [string, string][] = [
  ["Just one small change.", "it's checked against the approved scope, and the revision round is counted."],
  ["Can you also make a reel from this?", "new work becomes a change order, priced and approved before you start."],
  ["It'll only take five minutes.", "the request, the date and who asked are kept on the project timeline."],
  ["We'll pay after the next round.", "what's due and what's paid sits on your client's page, so nobody forgets."],
];

function Heard() {
  const [i, setI] = useState(0);
  const go = (d: number) => setI((x) => (x + d + HEARD.length) % HEARD.length);
  const [q, a] = HEARD[i];
  return (
    <section className="hm-wrap hm-sec" aria-labelledby="heard-title">
      <div className="mb-10 flex items-center justify-between gap-5 sm:mb-12">
        <h2 id="heard-title" className="hm-h3 max-w-[18ch]">
          What every freelancer has heard
        </h2>
        <div className="flex shrink-0 gap-3">
          <button type="button" className="hm-round hm-round-lg" onClick={() => go(-1)} aria-label="Previous line">
            <Chevron dir="left" />
          </button>
          <button type="button" className="hm-round hm-round-lg" onClick={() => go(1)} aria-label="Next line">
            <Chevron dir="right" />
          </button>
        </div>
      </div>
      <figure key={i} className="hm-quote hm-fade" aria-live="polite">
        <svg width="52" height="52" viewBox="0 0 56 56" aria-hidden>
          <path d="M6 44 C6 24 16 10 32 6 L34 16 C24 19 19 26 18 34 L28 34 L28 48 L6 48 Z" fill="#ecece6" />
          <path d="M32 30 C33 22 38 17 46 15 L48 24 C43 25 41 28 40 32 L48 32 L48 48 L32 48 Z" fill="#ecece6" opacity=".55" />
        </svg>
        <blockquote className="mt-8 text-[clamp(21px,2.6vw,27px)] leading-[1.35] tracking-[-0.03em] text-[var(--hm-text)]">“{q}”</blockquote>
        <p className="mt-4 text-[17px] leading-relaxed text-[var(--hm-muted)]">
          <span className="text-[var(--hm-blue)]">With ScopeFlow:</span> {a}
        </p>
        <figcaption className="mt-10 text-right">
          <span className="block text-[19px] font-medium text-[var(--hm-text)]">Every client</span>
          <span className="mt-1 block text-[16px] tabular-nums text-[var(--hm-muted)]">
            at some point · {String(i + 1).padStart(2, "0")} / {String(HEARD.length).padStart(2, "0")}
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

// ---------------------------------------------------------------- blog

/** The 3 newest blog posts, loaded in the browser (the section and its link are in the page from the start). */
function FromTheBlog() {
  const list = useBlogList();
  const posts = (list.data ?? []).slice(0, 3);
  return (
    <section id="blog" className="hm-wrap hm-sec scroll-mt-24" aria-labelledby="from-the-blog" data-testid="home-blog">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-5 sm:mb-12">
        <div className="max-w-[36rem]">
          <h2 id="from-the-blog" className="hm-h3">
            From the blog
          </h2>
          <p className="mt-3 text-[17px] leading-relaxed text-[var(--hm-muted)]">Fresh guides for Indian freelancers every week: market rates, strategies and success stories.</p>
        </div>
        <Link to="/blog" className="hm-arrow-link">
          Read the blog
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 3l12 9-12 9 3-9z" />
          </svg>
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {list.isPending ? (
          [0, 1, 2].map((k) => <div key={k} className="hm-card h-64" aria-hidden />)
        ) : posts.length ? (
          posts.map((p) => (
            <Link key={p.slug} to={`/blog/${p.slug}`} className="hm-card group flex flex-col transition-colors hover:bg-[#202020]">
              {p.cover_image ? <img src={p.cover_image} alt="" loading="lazy" decoding="async" className="aspect-[16/9] w-full object-cover" /> : null}
              <span className="flex flex-1 flex-col p-6">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--hm-orange)]">{categoryOf(p.category).label}</span>
                <span className="mt-3 text-[19px] font-semibold leading-snug tracking-[-0.02em] text-[var(--hm-text)] group-hover:underline">{p.title}</span>
                <span className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-[var(--hm-muted)]">{p.description}</span>
                <span className="mt-auto pt-5 text-[13px] text-[var(--hm-faint)]">{formatPostDate(p.published_at)}</span>
              </span>
            </Link>
          ))
        ) : (
          <Link to="/blog" className="hm-card p-6 text-[15px] text-[var(--hm-muted)] hover:bg-[#202020] md:col-span-3">
            <span className="block text-[19px] font-semibold text-[var(--hm-text)]">The first posts are on their way.</span>
            Guides on pricing, clients and growth for freelancers in India. Visit the blog →
          </Link>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- questions

function Questions() {
  return (
    <section id="questions" className="hm-wrap hm-sec max-w-[1040px] scroll-mt-24" aria-labelledby="faq-title">
      <h2 id="faq-title" className="mb-10 text-[clamp(34px,5vw,56px)] font-normal leading-[1.05] tracking-[-0.045em] sm:mb-12">
        Let’s clear a few things up
      </h2>
      <div className="border-t border-[var(--hm-line)]">
        {[...HOME_FAQ, ...HOME_FAQ_EARLY].map(([q, a], i) => (
          <details key={q} className="hm-qa" open={i === 0}>
            <summary>
              <span>{q}</span>
              <svg className="hm-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 1 C12.9 8.2 15.8 11.1 23 12 C15.8 12.9 12.9 15.8 12 23 C11.1 15.8 8.2 12.9 1 12 C8.2 11.1 11.1 8.2 12 1 Z" />
              </svg>
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <p className="mt-8 text-[15px] text-[var(--hm-muted)]">
        More on <Link to="/pricing" className="text-[var(--hm-text)] underline underline-offset-4">plans and pricing</Link>, or write to{" "}
        <a href={supportMailto("Question about ScopeFlow")} className="text-[var(--hm-text)] underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- start (hands over to the real sign-up)

function Start() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    // Handed over in navigation state, not the address, so an email never lands in URLs, logs or referrers.
    navigate("/signup", { state: { name: name.trim().slice(0, 120), email: email.trim().slice(0, 254) } });
  }
  return (
    <section id="start" className="hm-glow mt-[clamp(110px,14vw,170px)]" aria-labelledby="start-title">
      <div className="hm-wrap relative grid grid-cols-1 gap-10 py-[clamp(80px,10vw,120px)] lg:grid-cols-2 lg:items-start lg:gap-16">
        <div className="flex flex-col gap-5">
          <h2 id="start-title" className="hm-h2 text-left text-white">
            Let’s put your next job on the record.
          </h2>
          <p className="max-w-[28rem] text-[18px] leading-relaxed tracking-[-0.02em] text-[#d2d0ca]">Free for 2 active projects and 5 clients. No card needed. Solo is ₹499 a month when you need more.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3.5" aria-label="Start free">
          <label htmlFor="start-name" className="sr-only">
            Your name
          </label>
          <input id="start-name" className="hm-field" placeholder="Your name" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="start-email" className="sr-only">
            Email
          </label>
          <input id="start-email" className="hm-field" type="email" placeholder="Email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="hm-send">
            Continue to sign up
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
          <p className="text-[14px] text-[#c9c7c2]">
            You'll choose a password on the next step. Already have an account?{" "}
            <Link to="/login" className="text-white underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- footer

function Footer() {
  return (
    <footer className="hm-wrap pb-12 pt-[clamp(80px,10vw,110px)]">
      <Link to="/" aria-label="ScopeFlow home" className="block">
        <LogoFull tone="white" className="block h-auto w-full" aria-hidden />
      </Link>
      <div className="mt-14 flex flex-col gap-7 border-t border-[var(--hm-line)] pt-12 sm:mt-16">
        <nav className="hm-flinks" aria-label="Footer">
          <Link to="/">Home</Link>
          <a href="/#product">Product</a>
          <Link to="/pricing">Pricing</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/contact">Contact</Link>
        </nav>
        <nav className="hm-flinks hm-flinks-u" aria-label="Contact">
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
            Instagram
          </a>
          <a href={supportMailto("ScopeFlow support")}>{SUPPORT_EMAIL}</a>
        </nav>
      </div>
      <div className="mt-12 flex flex-col items-center gap-2 border-t border-[var(--hm-line)] pt-12 text-center">
        <p className="text-[16px] text-[var(--hm-muted)]" data-testid="built-by">{`Built in ${OPERATOR_CITY} by ${OPERATOR_NAME}`}</p>
        <p className="max-w-[36rem] text-[14px] text-[var(--hm-faint)]">ScopeFlow records payments between you and your clients; it doesn't handle that money.</p>
        <p className="mt-2 text-[14px] text-[var(--hm-faint)]">© {new Date().getFullYear()} ScopeFlow. All rights reserved</p>
      </div>
      <nav className="hm-flinks mt-10 border-t border-[var(--hm-line)] pt-10 text-[15px]" aria-label="Legal">
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms &amp; Conditions</Link>
        <Link to="/refunds">Refunds &amp; cancellation</Link>
      </nav>
    </footer>
  );
}
