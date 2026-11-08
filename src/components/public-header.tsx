import type { ReactNode } from "react";
import { Link } from "react-router";
import { LogoFull } from "./brand";
import { buttonClass, cx } from "./ui";

/**
 * The header on every public page (home, pricing, blog, legal): the full ScopeFlow wordmark at every
 * width, Pricing and the main button always visible. On phones the other links sit in a small menu
 * (Blog shows from 400px). Product and How it works point at the home page sections.
 */
export function PublicHeader({
  tone = "light",
  className,
  action,
  extra,
  signIn = true,
  badge,
  floating = false,
}: {
  tone?: "light" | "dark";
  /** The home page's look: logo and links as two floating rounded cards on near-black. */
  floating?: boolean;
  className?: string;
  /** The main button (defaults to Start free). */
  action?: { to: string; label: string };
  /** Extra links before Pricing (e.g. the blog's Write link). */
  extra?: ReactNode;
  /** Show the Sign in link (signed-out pages). */
  signIn?: boolean;
  badge?: ReactNode;
}) {
  const dark = tone === "dark" || floating;
  const base = cx("rounded-lg py-2 text-[14px] font-medium whitespace-nowrap", floating ? "text-[#c9c7c2] hover:text-white" : dark ? "text-[#98a2b3] hover:text-white" : "text-ink-2 hover:text-ink");
  const link = cx(base, "px-2 sm:px-3");
  const main = action ?? { to: "/signup", label: "Start free" };
  return (
    <header className={className ?? (floating ? "hm-header" : "border-b border-line bg-surface/80 backdrop-blur")} data-testid="public-header">
      <div className={floating ? "mx-auto flex max-w-[1400px] items-center justify-between gap-1.5 min-[360px]:gap-2" : "mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"}>
        <div className={cx("flex min-w-0 items-center gap-2", floating && "hm-navcard px-3 min-[360px]:px-4 sm:px-6")}>
          <Link to="/" aria-label="ScopeFlow home" className="inline-flex shrink-0 items-center">
            <LogoFull tone={dark ? "white" : "color"} className="h-5 w-auto min-[360px]:h-[22px] sm:h-8" />
          </Link>
          {badge}
        </div>
        <nav className={cx("flex items-center gap-0.5 sm:gap-1", floating && "hm-navcard px-1 min-[360px]:px-1.5 sm:pl-3")} aria-label="Main">
          <a href="/#product" className={cx(link, "hidden md:block")}>
            Product
          </a>
          <a href="/#how" className={cx(link, "hidden md:block")}>
            How it works
          </a>
          {extra}
          <Link to="/pricing" className={cx(base, "px-1 text-[13px] min-[360px]:px-1.5 min-[360px]:text-[14px] sm:px-3")}>
            Pricing
          </Link>
          <Link to="/blog" className={cx(link, "hidden min-[400px]:block")}>
            Blog
          </Link>
          {signIn ? (
            <Link to="/login" className={cx(link, "hidden sm:block")}>
              Sign in
            </Link>
          ) : null}
          <Link to={main.to} className={floating ? "hm-navbtn" : cx(buttonClass("primary", "sm"), "ml-0.5 whitespace-nowrap", dark && "rounded-lg")}>
            {main.label}
          </Link>
          <details className="relative sm:hidden" data-testid="public-menu">
            <summary
              aria-label="More links"
              className={cx(
                "flex size-7 cursor-pointer list-none items-center justify-center rounded-lg [&::-webkit-details-marker]:hidden",
                floating ? "text-[#c9c7c2] hover:text-white" : dark ? "text-[#98a2b3] hover:text-white" : "text-ink-2 hover:text-ink",
              )}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <div className={floating ? "hm-menu" : "absolute right-0 top-10 z-50 w-44 rounded-xl border border-line bg-surface p-1.5 text-ink shadow-[var(--shadow-pop)]"}>
              <a href="/#product" className="block rounded-lg px-3 py-2 text-[14px] hover:bg-sunken hm-menu-a">
                Product
              </a>
              <a href="/#how" className="block rounded-lg px-3 py-2 text-[14px] hover:bg-sunken hm-menu-a">
                How it works
              </a>
              <Link to="/blog" className="block rounded-lg px-3 py-2 text-[14px] hover:bg-sunken hm-menu-a">
                Blog
              </Link>
              {signIn ? (
                <Link to="/login" className="block rounded-lg px-3 py-2 text-[14px] hover:bg-sunken hm-menu-a">
                  Sign in
                </Link>
              ) : null}
            </div>
          </details>
        </nav>
      </div>
    </header>
  );
}
