import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
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

function Bell({ count }: { count: number }) {
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) => cx(buttonClass("ghost", "sm"), "relative px-2.5", isActive && "bg-sunken")}
      aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
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
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();
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
            <Bell count={unread.data ?? 0} />
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
                <Link to="/dashboard" className="block rounded-md px-3 py-2 text-sm hover:bg-sunken sm:hidden">
                  Dashboard
                </Link>
                <Link to="/clients" className="block rounded-md px-3 py-2 text-sm hover:bg-sunken sm:hidden">
                  Clients
                </Link>
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
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-[12px] text-muted sm:px-6 print:hidden">
        Something missing or not working?{" "}
        <a href={feedbackMailto(location.pathname)} className="font-medium text-accent hover:underline" data-testid="feedback-link">
          Send feedback
        </a>{" "}
        and it comes straight to the ScopeFlow team.
      </footer>
    </div>
  );
}
