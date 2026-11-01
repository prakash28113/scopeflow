import type { ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useDashboard } from "@/lib/queries";
import { needsAttention, remindersFrom } from "@/lib/use-reminders";
import { Button, Logo, buttonClass, cx } from "./ui";
import { displayName, useAuth, useProfile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { BetaBadge } from "./site-footer";
import { feedbackMailto } from "@/lib/site";

export function PageSpinner() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center" role="status" aria-label="Loading">
      <span className="size-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}

/** UX guard only — every query and write is authorised again by RLS and database functions. */
export function RequireAuth({ allowUnonboarded = false }: { allowUnonboarded?: boolean }) {
  const { session, loading } = useAuth();
  const profile = useProfile();
  const location = useLocation();
  if (loading || (session && profile.isLoading)) return <PageSpinner />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (profile.isError || !profile.data) {
    // A signed-in user whose profile couldn't load (network blip, server busy): offer a retry,
    // don't bounce them to the sign-in page.
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center" role="alert">
        <p className="text-sm text-ink-2">Couldn&apos;t load your account. Check your connection and try again.</p>
        <div className="flex gap-2">
          <Button onClick={() => profile.refetch()}>Try again</Button>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  if (!allowUnonboarded && !profile.data.onboarded_at) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function useUnreadCount() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["notifications", "count"],
    enabled: Boolean(session),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("unread_notification_count");
      if (error) throw error;
      return data as number;
    },
  });
}

function Bell({ count, attention }: { count: number; attention: number }) {
  const label = ["Notifications", count ? `${count} unread` : "", attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : ""].filter(Boolean).join(", ");
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) => cx(buttonClass("ghost", "sm"), "relative px-2.5", isActive && "bg-sunken")}
      aria-label={label}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count ? (
        <span className="num absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
      {attention ? <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-canvas bg-danger" data-testid="bell-attention" /> : null}
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();
  const { session } = useAuth();
  const dash = useDashboard(Boolean(session));
  const profile = useProfile();
  const unread = useUnreadCount();
  const nav = ({ isActive }: { isActive: boolean }) => cx(buttonClass("ghost", "sm"), isActive && "bg-sunken text-ink");
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-5">
            <Link to="/dashboard" aria-label="ScopeFlow dashboard" className="flex items-center gap-2">
              <Logo className="text-[15px]" />
              <BetaBadge />
            </Link>
            <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
              <NavLink to="/dashboard" className={nav}>
                Dashboard
              </NavLink>
              <NavLink to="/clients" className={nav}>
                Clients
              </NavLink>
              <NavLink to="/invoices" className={nav}>
                Invoices
              </NavLink>
              <NavLink to="/analytics" className={nav}>
                Analytics
              </NavLink>
              <NavLink to="/plan" className={nav}>
                Plan
              </NavLink>
              <NavLink to="/settings" className={nav}>
                Settings
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-1.5">
            {profile.data ? (
              <span className="mr-1 hidden max-w-[180px] truncate text-[13px] text-muted md:block">{displayName(profile.data)}</span>
            ) : null}
            <Bell count={unread.data ?? 0} attention={dash.data ? needsAttention(remindersFrom(dash.data)) : 0} />
            <Link to="/projects/new" className={buttonClass("primary", "sm")}>
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New project</span>
            </Link>
            <details className="relative" key={location.pathname}>
              <summary className={cx(buttonClass("ghost", "sm"), "list-none cursor-pointer px-2.5")} aria-label="Account menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </summary>
              <div className="absolute right-0 mt-2 w-48 rounded-lg border border-line bg-surface p-1 shadow-[0_12px_32px_-16px_rgba(22,24,29,0.3)]">
                <Link to="/plan" className="block rounded-md px-3 py-2 text-sm hover:bg-sunken sm:hidden">
                  Plan & usage
                </Link>
                <Link to="/settings" className="block rounded-md px-3 py-2 text-sm hover:bg-sunken">
                  Settings
                </Link>
                <a href={feedbackMailto(location.pathname)} className="block rounded-md px-3 py-2 text-sm hover:bg-sunken">
                  Send feedback
                </a>
                <button
                  type="button"
                  className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sunken"
                  onClick={() => supabase.auth.signOut()}
                >
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
      <MobileTabBar />
      <footer className="mx-auto max-w-6xl px-4 pb-24 text-[12px] text-muted sm:mt-0 sm:px-6 sm:pb-10 print:hidden">
        Something missing or not working?{" "}
        <a href={feedbackMailto(location.pathname)} className="font-medium text-accent hover:underline" data-testid="feedback-link">
          Send feedback
        </a>{" "}
        and it comes straight to the ScopeFlow team.
      </footer>
    </div>
  );
}

const TABS: { to: string; label: string; icon: ReactNode }[] = [
  { to: "/dashboard", label: "Home", icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  { to: "/clients", label: "Clients", icon: <path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 9v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7" /> },
  { to: "/invoices", label: "Invoices", icon: <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5M9 13h6M9 17h6" /> },
  { to: "/analytics", label: "Analytics", icon: <path d="M4 20V10m6 10V4m6 16v-7m4 7H3" /> },
  { to: "/settings", label: "Settings", icon: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" /> },
];

/** Phones: the main sections one tap away at the bottom of the screen. */
function MobileTabBar() {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden print:hidden"
      data-testid="mobile-tabs"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-accent" : "text-muted")}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {t.icon}
              </svg>
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
