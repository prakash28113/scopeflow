/** Reads the URL fragment Supabase adds when a password-reset link is opened (implicit flow). */
export type RecoveryLink =
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "error"; message: string }
  | { kind: "none" };

export function readRecoveryHash(hash: string): RecoveryLink {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (p.get("error") || p.get("error_code")) {
    const expired = /expired|otp_expired|invalid/i.test(`${p.get("error_code")} ${p.get("error_description")}`);
    return { kind: "error", message: expired ? "This reset link has expired or was already used." : "This reset link isn't valid." };
  }
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  if (accessToken && refreshToken && p.get("type") === "recovery") return { kind: "tokens", accessToken, refreshToken };
  return { kind: "none" };
}
