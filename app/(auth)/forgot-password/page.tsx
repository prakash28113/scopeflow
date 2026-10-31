import Link from "next/link";
import type { Metadata } from "next";
import { ForgotPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Reset your password</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">We&apos;ll email you a link to choose a new one.</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
