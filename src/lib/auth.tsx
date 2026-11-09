import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { warmAccount } from "./warm";
import { myPlanQuery } from "./plans";
import { timeEnd } from "./timing";
import { pages } from "@/routes/loaders";

/** Public pages a signed-in visitor may be reading: nothing to warm up there. */
const PUBLIC_ENTRY = /^\/(|pricing|privacy|terms|refunds|contact|blog(\/.*)?|p(\/.*)?)$/;

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

/** Signing in or out never shows one account's cached data (names, projects, plan) to the next. */
export function clearOnAccountChange(event: string, qc: Pick<QueryClient, "clear">) {
  if (event === "SIGNED_OUT" || event === "SIGNED_IN") qc.clear();
}

/** Profile, plan and the first screen's code, all at once (T2-03). */
function warm(qc: QueryClient, userId: string) {
  void warmAccount(qc, [profileQuery(userId), myPlanQuery], [pages.dashboard]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  const qc = useQueryClient();
  useEffect(() => {
    // The app has taken over the page (on prerendered pages its code starts after the first picture).
    document.documentElement.dataset.app = "ready";
    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
      if (data.session && !PUBLIC_ENTRY.test(window.location.pathname)) warm(qc, data.session.user.id);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false });
      clearOnAccountChange(event, qc);
      if (event === "SIGNED_IN" && session) {
        timeEnd("sign-in:session");
        warm(qc, session.user.id);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  business_name: string | null;
  business_address?: string | null;
  gstin?: string | null;
  state_code?: string | null;
  sac_code?: string | null;
  invoice_prefix?: string;
  upi_id?: string | null;
  default_currency: string;
  onboarded_at: string | null;
  notifications_seen_at: string;
};

export const profileQuery = (userId: string | undefined) => ({
  queryKey: ["profile", userId] as const,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, business_name, default_currency, onboarded_at, notifications_seen_at, upi_id, business_address, gstin, invoice_prefix, state_code, sac_code")
      .eq("id", userId!)
      .single();
    if (error) throw error;
    return data as Profile;
  },
});

export function useProfile() {
  const { session } = useAuth();
  return useQuery({ ...profileQuery(session?.user.id), enabled: Boolean(session) });
}

export function displayName(p: Pick<Profile, "business_name" | "full_name" | "email">) {
  return p.business_name || p.full_name || p.email;
}
