import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">It may have been moved, or you may not have access to it.</p>
      <Link href="/dashboard" className={`${buttonClass("secondary")} mt-6`}>
        Go to dashboard
      </Link>
    </div>
  );
}
