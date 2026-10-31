"use client";

import { Button } from "@/components/ui";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The error has been logged. Please try again.</p>
      <Button variant="secondary" className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
