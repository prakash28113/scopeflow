import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { intentProps, prefetchPath } from "@/lib/prefetch";
import { preloadAppPages } from "@/routes/loaders";
import { useDashboard } from "@/lib/queries";
import { needsAttention, remindersFrom } from "@/lib/use-reminders";
import { Button, LinkButton, Skeleton, cx } from "./ui";
import { LogoFull } from "./brand";
import { displayName, useAuth, useProfile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { feedbackMailto } from "@/lib/site";

/** Loading state for a whole page: the shape of a page (title, a row of figures, a panel), not a spinner. */
export function PageSpinner() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 lg:px-8" role="status" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-8 w-72 max-w-full" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="mt-6 h-64" />
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

// ------------------------------------------------------------------ navigation

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; count?: number };
const I = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
    {d}
  </svg>
);
const ICONS = {
  overview: I(<path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z" />),
  projects: I(<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />),
  clients: I(<path d="M15.5 19v-1.2A3.3 3.3 0 0 0 12.2 14.5H6.8A3.3 3.3 0 0 0 3.5 17.8V19M9.5 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM20.5 19v-1.2a3.3 3.3 0 0 0-2.4-3.2M15.6 4.8a3.2 3.2 0 0 1 0 6" />),
  quotes: I(<path d="M7 3.5h7l4.5 4.5v11.5A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-14A1.5 1.5 0 0 1 7 3.5ZM14 3.5V8h4.5M9 13h6M9 16.5h4" />),
  invoices: I(<path d="M6 3.5h12v17l-2.5-1.5L13 20.5 10.5 19 8 20.5 6 19zM9 8.5h6M9 12h6M9 15.5h3" />),
  approvals: I(<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12.3l2.3 2.3 4.7-5" />),
  analytics: I(<path d="M4 20V11M10 20V5M16 20v-6M3 20h18" />),
  expenses: I(<path d="M3.5 7.5h17v11a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM3.5 7.5 6 4h12l2.5 3.5M15.5 13.5h2" />),
  settings: I(<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a7.5 7.5 0 0 0 0-3l2-1.5-2-3.5-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.4-.9-2 3.5 2 1.5a7.5 7.5 0 0 0 0 3l-2 1.5 2 3.5 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.5z" />),
  plan: I(<path d="M4 7.5 12 3.5l8 4-8 4zM4 12l8 4 8-4M4 16.5l8 4 8-4" />),
  bell: I(<><path d="M6 8.5a6 6 0 1 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5" /><path d="M10.3 20.5a1.9 1.9 0 0 0 3.4 0" /></>),
  plus: I(<path d="M12 5v14M5 12h14" />),
  menu: I(<path d="M4 7h16M4 12h16M4 17h16" />),
  close: I(<path d="M6 6l12 12M18 6 6 18" />),
};

function useNavGroups(approvalsWaiting: number): { label: string; items: NavItem[] }[] {
  return [
    {
      label: "Workspace",
      items: [
        { to: "/dashboard", label: "Overview", icon: ICONS.overview },
        { to: "/projects", label: "Projects", icon: ICONS.projects, end: true },
        { to: "/clients", label: "Clients", icon: ICONS.clients },
      ],
    },
    {
      label: "Work",
      items: [
        { to: "/quotations", label: "Quotations", icon: ICONS.quotes },
        { to: "/invoices", label: "Invoices", icon: ICONS.invoices },
        { to: "/approvals", label: "Approvals", icon: ICONS.approvals, count: approvalsWaiting },
      ],
    },
    {
      label: "Business",
      items: [
        { to: "/analytics", label: "Analytics", icon: ICONS.analytics },
        { to: "/expenses", label: "Expenses", icon: ICONS.expenses },
      ],
    },
    {
      label: "Preferences",
      items: [
        { to: "/settings", label: "Settings", icon: ICONS.settings },
        { to: "/plan", label: "Plan & usage", icon: ICONS.plan },
      ],
    },
  ];
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const dash = useDashboard(Boolean(session));
  const waiting = dash.data ? dash.data.projects.filter((p) => p.status === "awaiting_approval").length + dash.data.changeOrders.length : 0;
  const groups = useNavGroups(waiting);
  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-2.5 pb-1.5 text-[12px] font-medium text-chrome-muted">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  {...intentProps(qc, it.to)}
                  className={({ isActive }) =>
                    cx(
                      "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium transition-colors",
                      isActive ? "bg-chrome-2 text-white" : "text-chrome-text hover:bg-chrome-2/70 hover:text-white",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" aria-hidden /> : null}
                      <span className={isActive ? "text-white" : "text-chrome-muted group-hover:text-chrome-text"}>{it.icon}</span>
                      <span className="flex-1">{it.label}</span>
                      {it.count ? (
                        <span className="num rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-white" aria-label={`${it.count} waiting`}>
                          {it.count}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

/** Who's signed in, with the account menu (settings, plan, feedback, sign out). */
function AccountMenu({ dark = true }: { dark?: boolean }) {
  const profile = useProfile();
  const location = useLocation();
  const name = profile.data ? displayName(profile.data) : "";
  const business = profile.data?.business_name;
  return (
    <details className="group relative" key={location.pathname}>
      <summary
        aria-label="Account menu"
        className={cx(
          "flex cursor-pointer list-none items-center gap-2.5 rounded-lg p-2 transition-colors [&::-webkit-details-marker]:hidden",
          dark ? "hover:bg-chrome-2" : "hover:bg-sunken",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white" aria-hidden>
          {initials(business || name)}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className={cx("block truncate text-[13px] font-semibold", dark ? "text-white" : "text-ink")}>{business || name}</span>
          {business ? <span className={cx("block truncate text-[12px]", dark ? "text-chrome-muted" : "text-muted")}>{name}</span> : null}
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" className={cx("shrink-0 transition-transform group-open:rotate-180", dark ? "text-chrome-muted" : "text-muted")} aria-hidden>
          <path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute inset-x-0 bottom-full z-40 mb-2 rounded-xl border border-line bg-surface p-1 text-ink shadow-[var(--shadow-pop)]">
        <Link to="/settings" className="block rounded-lg px-3 py-2 text-sm hover:bg-sunken">
          Settings
        </Link>
        <Link to="/plan" className="block rounded-lg px-3 py-2 text-sm hover:bg-sunken">
          Plan &amp; usage
        </Link>
        <a href={feedbackMailto(location.pathname)} className="block rounded-lg px-3 py-2 text-sm hover:bg-sunken">
          Send feedback
        </a>
        <div className="my-1 border-t border-line" />
        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </details>
  );
}

function Bell({ count, attention, dark = false }: { count: number; attention: number; dark?: boolean }) {
  const label = ["Notifications", count ? `${count} unread` : "", attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : ""].filter(Boolean).join(", ");
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) =>
        cx(
          "relative grid size-9 place-items-center rounded-lg transition-colors",
          dark ? "text-chrome-text hover:bg-chrome-2" : "text-ink-2 hover:bg-sunken",
          isActive && (dark ? "bg-chrome-2 text-white" : "bg-sunken text-ink"),
        )
      }
      aria-label={label}
    >
      {ICONS.bell}
      {count ? (
        <span className="num absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
      {attention ? <span className="absolute bottom-1 right-1 size-2.5 rounded-full border-2 border-canvas bg-danger" data-testid="bell-attention" /> : null}
    </NavLink>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/dashboard" onClick={onNavigate} aria-label="ScopeFlow overview" className="flex items-center gap-2">
      <LogoFull tone="white" className="h-[25px] w-auto" />
      <span className="rounded-full bg-chrome-2 px-2 py-0.5 text-[11px] font-medium leading-none text-chrome-text ring-1 ring-chrome-line">Beta</span>
    </Link>
  );
}

/** Phones and tablets: the same navigation, in a drawer from the left. */
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label="Menu"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="sf-dialog sf-drawer m-0 h-dvh max-h-none w-[min(300px,86vw)] max-w-none bg-chrome p-0 text-chrome-text lg:hidden"
      data-testid="nav-drawer"
    >
      {open ? (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center justify-between px-4">
          <Brand onNavigate={onClose} />
          <button type="button" onClick={onClose} aria-label="Close menu" className="grid size-9 place-items-center rounded-lg text-chrome-text hover:bg-chrome-2">
            {ICONS.close}
          </button>
        </div>
        <div className="px-3">
          <LinkButton to="/projects/new" onClick={onClose} className="w-full">
            {ICONS.plus}
            New project
          </LinkButton>
        </div>
        <NavContent onNavigate={onClose} />
        <div className="border-t border-chrome-line p-2">
          <AccountMenu />
        </div>
      </div>
      ) : null}
    </dialog>
  );
}

/** Where you are, for the top bar: "Group / Section". */
function sectionOf(path: string): string {
  const table: [RegExp, string][] = [
    [/^\/dashboard/, "Workspace / Overview"],
    [/^\/projects\/new/, "Workspace / Projects / New project"],
    [/^\/projects/, "Workspace / Projects"],
    [/^\/clients/, "Workspace / Clients"],
    [/^\/quotations/, "Work / Quotations"],
    [/^\/invoices/, "Work / Invoices"],
    [/^\/approvals/, "Work / Approvals"],
    [/^\/analytics/, "Business / Analytics"],
    [/^\/expenses/, "Business / Expenses"],
    [/^\/settings/, "Preferences / Settings"],
    [/^\/plan/, "Preferences / Plan & usage"],
    [/^\/notifications/, "Notifications"],
  ];
  return table.find(([re]) => re.test(path))?.[1] ?? "";
}

export function AppShell() {
  const location = useLocation();
  const { session } = useAuth();
  const dash = useDashboard(Boolean(session));
  const unread = useUnreadCount();
  const attention = dash.data ? needsAttention(remindersFrom(dash.data)) : 0;
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [location.pathname]);
  const qc = useQueryClient();
  // Once the app has loaded: download every page's code, and the client, invoice and analytics data, in the background.
  useEffect(() => {
    if (!session) return;
    preloadAppPages();
    const t = setTimeout(() => {
      prefetchPath(qc, "/clients");
      prefetchPath(qc, "/invoices");
      prefetchPath(qc, "/analytics");
    }, 1500);
    return () => clearTimeout(t);
  }, [session, qc]);

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* Desktop: fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-chrome lg:flex print:hidden">
        <div className="flex h-14 items-center px-5">
          <Brand />
        </div>
        <div className="px-3 pt-1">
          <LinkButton to="/projects/new" className="w-full">
            {ICONS.plus}
            New project
          </LinkButton>
        </div>
        <NavContent />
        <div className="border-t border-chrome-line p-2">
          <AccountMenu />
        </div>
      </aside>

      {/* Top bar: menu (phones), notifications */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-2 px-4 sm:px-6 lg:px-8">
          <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" className="-ml-1.5 grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-sunken lg:hidden">
            {ICONS.menu}
          </button>
          <Link to="/dashboard" aria-label="ScopeFlow overview" className="lg:hidden">
            <LogoFull className="h-[22px] w-auto" />
          </Link>
          <p className="hidden min-w-0 truncate text-[13px] text-muted lg:block" data-testid="section-label">
            {sectionOf(location.pathname)}
          </p>
          <div className="flex-1" />
          <Bell count={unread.data ?? 0} attention={attention} />
          <LinkButton to="/projects/new" size="sm" className="lg:hidden" aria-label="New project">
            {ICONS.plus}
            <span className="hidden sm:inline">New project</span>
          </LinkButton>
        </div>
      </header>
      <MobileDrawer open={menu} onClose={() => setMenu(false)} />

      <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-[1180px] px-4 pb-10 text-[12px] text-muted sm:px-6 lg:px-8 print:hidden">
        Something missing or not working?{" "}
        <a href={feedbackMailto(location.pathname)} className="font-medium text-accent hover:underline" data-testid="feedback-link">
          Send feedback
        </a>{" "}
        and it comes straight to the ScopeFlow team.
      </footer>
    </div>
  );
}
