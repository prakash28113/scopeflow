import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/projects", "/onboarding"];

/**
 * Refreshes the Supabase session cookie and keeps signed-out visitors away
 * from the app. Authorisation itself is enforced again in every server
 * action and by RLS — this is only a convenience redirect.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login);
  }
  if (user && (path === "/login" || path === "/signup")) {
    const dash = request.nextUrl.clone();
    dash.pathname = "/dashboard";
    dash.search = "";
    return NextResponse.redirect(dash);
  }
  return response;
}

export const config = {
  // The client portal (/p/...) needs no session, so it is skipped entirely.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|p/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
