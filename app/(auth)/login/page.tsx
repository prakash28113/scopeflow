import Link from "next/link";
import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { SignInForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Welcome back</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">Sign in to manage your projects.</p>
      {error ? (
        <div className="mb-4">
          <Alert>That link is invalid or has expired. Please try again.</Alert>
        </div>
      ) : null}
      <SignInForm next={next} />
      <p className="mt-6 text-center text-sm text-muted">
        New to ScopeFlow?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
