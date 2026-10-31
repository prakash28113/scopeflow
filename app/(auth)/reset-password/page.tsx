import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/forgot-password");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Choose a new password</h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">For {data.user.email}</p>
      <ResetPasswordForm />
    </>
  );
}
