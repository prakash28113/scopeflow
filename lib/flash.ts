import "server-only";
import { cookies } from "next/headers";

export type Flash = { tone: "positive" | "danger" | "info"; message: string };

const NAME = "sf_flash";

/** One-shot message shown after a redirecting server action. */
export async function setFlash(flash: Flash) {
  (await cookies()).set(NAME, JSON.stringify(flash), { path: "/", maxAge: 30, sameSite: "lax", httpOnly: false });
}

export async function readFlash(): Promise<Flash | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Flash;
    if (typeof f.message !== "string" || !["positive", "danger", "info"].includes(f.tone)) return null;
    return { tone: f.tone, message: f.message.slice(0, 300) };
  } catch {
    return null;
  }
}
