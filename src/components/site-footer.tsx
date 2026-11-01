import { Link } from "react-router";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-24 flex max-w-6xl flex-col gap-3 border-t border-line px-4 py-8 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p>ScopeFlow tracks payments you record; it doesn&apos;t process payments.</p>
      <nav className="flex flex-wrap gap-x-5 gap-y-2">
        <Link to="/privacy" className="hover:text-ink">Privacy</Link>
        <Link to="/terms" className="hover:text-ink">Terms</Link>
        <a href={supportMailto("ScopeFlow support")} className="hover:text-ink">{SUPPORT_EMAIL}</a>
      </nav>
    </footer>
  );
}

export function BetaBadge() {
  return (
    <span className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[11px] font-medium leading-none text-accent">Beta</span>
  );
}
