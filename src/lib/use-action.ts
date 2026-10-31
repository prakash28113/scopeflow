import { useState } from "react";
import type { z } from "zod";
import { issuesToFieldErrors, type FieldErrors } from "./validation";
import { userMessage } from "./errors";

type DbError = { code?: string; message?: string } | null;

/**
 * Runs a form submission: validate with zod, call the database, map errors.
 * Database errors are filtered through userMessage(), so only messages we
 * raised on purpose reach the screen.
 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function run<S extends z.ZodType, R>(
    schema: S,
    input: unknown,
    call: (data: z.output<S>) => PromiseLike<{ data: R; error: DbError }>,
  ): Promise<R | undefined> {
    setError(null);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      setFieldErrors(issuesToFieldErrors(parsed.error));
      setError("Please fix the highlighted fields.");
      return undefined;
    }
    setFieldErrors({});
    setPending(true);
    try {
      const { data, error } = await call(parsed.data);
      if (error) {
        setError(userMessage(error));
        return undefined;
      }
      return data;
    } catch (e) {
      console.error(e);
      setError("Couldn't reach the server. Check your connection and try again.");
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, fieldErrors, setError };
}

/** Plain database call without a form (buttons like "Mark paid"). */
export async function call<R>(fn: () => PromiseLike<{ data: R; error: DbError }>): Promise<{ ok: true; data: R } | { ok: false; message: string }> {
  try {
    const { data, error } = await fn();
    if (error) return { ok: false, message: userMessage(error) };
    return { ok: true, data };
  } catch (e) {
    console.error(e);
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
}
