import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth, useProfile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button, Skeleton } from "./ui";

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
