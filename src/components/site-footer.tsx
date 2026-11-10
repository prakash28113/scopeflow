import { Link } from "react-router";
import { businessGstinLine } from "@/lib/business";
import { INSTAGRAM_URL, OPERATOR_CITY, OPERATOR_NAME, SUPPORT_EMAIL, supportMailto } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-24 flex max-w-6xl flex-col gap-3 border-t border-line px-4 py-8 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="space-y-1">
        <p data-testid="built-by">{`Built in ${OPERATOR_CITY} by ${OPERATOR_NAME}`}</p>
        {businessGstinLine() ? <p data-testid="business-gstin">{businessGstinLine()}</p> : null}
        <p>ScopeFlow records payments between you and your clients; it doesn&apos;t handle that money.</p>
      </div>
      <nav className="flex flex-wrap gap-x-5 gap-y-2">
        <Link to="/pricing" className="hover:text-ink">Pricing</Link>
        <Link to="/blog" className="hover:text-ink">Blog</Link>
        <Link to="/privacy" className="hover:text-ink">Privacy</Link>
        <Link to="/terms" className="hover:text-ink">Terms &amp; Conditions</Link>
        <Link to="/refunds" className="hover:text-ink">Refunds &amp; cancellation</Link>
        <Link to="/contact" className="hover:text-ink">Contact</Link>
        <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="hover:text-ink">Instagram</a>
        <a href={supportMailto("ScopeFlow support")} className="hover:text-ink">{SUPPORT_EMAIL}</a>
      </nav>
    </footer>
  );
}

export const BETA_TITLE = "Beta: new features ship weekly; prices shown are real.";

export function BetaBadge() {
  return (
    <span
      title={BETA_TITLE}
      data-testid="beta-badge"
      className="shrink-0 rounded-full border border-accent-line bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent min-[430px]:px-2 min-[430px]:text-[11px]"
    >
      Beta
    </span>
  );
}
