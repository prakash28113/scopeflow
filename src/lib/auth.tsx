import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

/** Signing in or out never shows one account's cached data (names, projects, plan) to the next. */
export function clearOnAccountChange(event: string, qc: Pick<QueryClient, "clear">) {
  if (event === "SIGNED_OUT" || event === "SIGNED_IN") qc.clear();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  const qc = useQueryClient();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false });
      clearOnAccountChange(event, qc);
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

export function useProfile() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["profile", session?.user.id],
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, business_name, default_currency, onboarded_at, notifications_seen_at, upi_id, business_address, gstin, invoice_prefix, state_code, sac_code")
        .eq("id", session!.user.id)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

export function displayName(p: Pick<Profile, "business_name" | "full_name" | "email">) {
  return p.business_name || p.full_name || p.email;
}
