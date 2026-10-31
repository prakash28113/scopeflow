import Link from "next/link";
import type { Metadata } from "next";
import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Create your account</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">Free while you set up your first projects.</p>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
