import { Turnstile } from "@marsidev/react-turnstile";

export const captchaSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || null;

/** Cloudflare Turnstile (free). Rendered only when VITE_TURNSTILE_SITE_KEY is set. */
export function Captcha({ onToken }: { onToken: (token: string | null) => void }) {
  if (!captchaSiteKey) return null;
  return (
    <Turnstile
      siteKey={captchaSiteKey}
      options={{ size: "flexible", theme: "light" }}
      onSuccess={onToken}
      onExpire={() => onToken(null)}
      onError={() => onToken(null)}
    />
  );
}
