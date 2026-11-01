import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { GOOGLE_CLIENT_ID } from "@/lib/site";

/**
 * "Continue with Google" using Google Identity Services (the official button) and
 * Supabase's ID-token sign-in. The Google popup names ScopeFlow (not the Supabase URL).
 * A fresh nonce per page load: Google gets its SHA-256, Supabase checks the raw value,
 * so a Google token can't be replayed into ScopeFlow.
 */
type GoogleCredential = { credential?: string };
type GoogleId = {
  initialize(o: {
    client_id: string;
    callback: (r: GoogleCredential) => void;
    nonce: string;
    ux_mode?: "popup";
    auto_select?: boolean;
    itp_support?: boolean;
    context?: "signin" | "signup";
  }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SCRIPT = "https://accounts.google.com/gsi/client";
let loading: Promise<void> | null = null;
function loadGoogle(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Google sign-in couldn't load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
}
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const googleSignInAvailable = Boolean(GOOGLE_CLIENT_ID);

export function GoogleSignIn({
  context,
  onSignedIn,
  onError,
  note,
}: {
  context: "signin" | "signup";
  note?: ReactNode;
  onSignedIn: () => void;
  onError: (message: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "signing-in">("loading");

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    const raw = randomNonce();
    (async () => {
      try {
        const [hashed] = await Promise.all([sha256Hex(raw), loadGoogle()]);
        if (cancelled || !box.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: hashed,
          ux_mode: "popup",
          auto_select: false,
          itp_support: true,
          context,
          callback: async ({ credential }) => {
            if (!credential) return onError("Google sign-in was cancelled. Please try again.");
            setState("signing-in");
            const { error } = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: credential,
              nonce: raw,
            });
            if (error) {
              setState("ready");
              const msg = error.message ?? "";
              if (/database error saving new user/i.test(msg)) return onError("Sign-ups are invite-only right now.");
              if (/provider is not enabled|unsupported provider/i.test(msg))
                return onError("Google sign-in isn't switched on yet. Please use email and password.");
              return onError("Couldn't sign in with Google. Please try again, or use email and password.");
            }
            onSignedIn();
          },
        });
        const width = Math.min(400, Math.max(240, Math.round(box.current.getBoundingClientRect().width)));
        window.google.accounts.id.renderButton(box.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          logo_alignment: "center",
          width,
        });
        setState("ready");
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
    // The callback reads the latest onSignedIn/onError through closure on each render's effect run; one setup per mount is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  if (!GOOGLE_CLIENT_ID || state === "unavailable") return null;
  return (
    <div className="space-y-4" data-testid="google-signin">
      <div className="flex min-h-[44px] w-full items-center justify-center" aria-busy={state !== "ready"}>
        <div ref={box} className="flex w-full justify-center" />
      </div>
      {state === "signing-in" ? <p className="text-center text-[13px] text-muted">Signing you in…</p> : null}
      {note ? <p className="text-center text-[12px] leading-relaxed text-muted">{note}</p> : null}
      <div className="flex items-center gap-3 text-[12px] text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        or use email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
