import { Turnstile } from "@marsidev/react-turnstile";

export const captchaSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || null;

/**
 * Cloudflare Turnstile (free). Rendered only when VITE_TURNSTILE_SITE_KEY is set; without it the
 * forms work exactly as before and send no token.
 * A token works once: change `attempt` after every submit to get a fresh widget and token.
 */
export function Captcha({ onToken, attempt = 0 }: { onToken: (token: string | null) => void; attempt?: number }) {
  if (!captchaSiteKey) return null;
  return (
    <div data-testid="captcha">
      <Turnstile
        key={attempt}
        siteKey={captchaSiteKey}
        options={{ size: "flexible", theme: "auto" }}
        onSuccess={onToken}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
      />
    </div>
  );
}
