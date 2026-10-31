import Link from "next/link";
import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Link href="/" aria-label="ScopeFlow home">
          <Logo className="text-[15px]" />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}
