/**
 * Ask a provider for JSON that matches a schema, validate it in the application, and retry once
 * with the validation errors if the first answer doesn't fit. The model's text is never trusted
 * as-is: anything that fails the schema is rejected.
 */
import { z } from "zod";
import { ProviderError, type Message, type Provider } from "./providers";

/** Pulls the JSON object out of a model answer (tolerates code fences and chatter around it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the answer");
  return JSON.parse(body.slice(start, end + 1));
}

/** Models often send "" or "none" for empty values; normalise before validating. */
function tidy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(tidy).filter((x) => x !== undefined);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, tidy(x)]));
  if (typeof v === "string" && /^(null|none|n\/a)$/i.test(v.trim())) return null;
  return v;
}

const issues = (e: z.ZodError) =>
  e.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

export async function generateStructured<S extends z.ZodType>(
  provider: Provider,
  opts: { system: string; user: string; history?: Message[]; schema: S; maxTokens: number },
): Promise<{ value: z.infer<S>; provider: string }> {
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const messages: Message[] = [
    { role: "system", content: `${opts.system}\n\nAnswer with one JSON object only, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` },
    ...(opts.history ?? []),
    { role: "user", content: opts.user },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const turn: Message[] =
      attempt === 0
        ? messages
        : [...messages, { role: "user", content: `Your last answer didn't match the schema (${lastError}). Send the corrected JSON object only.` }];
    const answer = await provider.generate({ messages: turn, maxTokens: opts.maxTokens, jsonSchema });
    let parsed: unknown;
    try {
      parsed = tidy(extractJson(answer.text));
    } catch (e) {
      lastError = e instanceof Error ? e.message : "not JSON";
      continue;
    }
    const r = opts.schema.safeParse(parsed);
    if (r.success) return { value: r.data, provider: answer.provider };
    lastError = issues(r.error);
  }
  throw new ProviderError(`answer didn't match the schema: ${lastError}`, provider.name);
}
