import Link from "next/link";
import { Logo, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const display = profile.business_name || profile.full_name || profile.email;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" aria-label="Dashboard">
              <Logo className="text-[15px]" />
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              <Link href="/dashboard" className={buttonClass("ghost", "sm")}>
                Dashboard
              </Link>
              <Link href="/onboarding?settings=1" className={buttonClass("ghost", "sm")}>
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[200px] truncate text-[13px] text-muted md:block">{display}</span>
            <Link href="/projects/new" className={buttonClass("primary", "sm")}>
              New project
            </Link>
            <form action={signOut}>
              <button className={buttonClass("ghost", "sm")}>Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
