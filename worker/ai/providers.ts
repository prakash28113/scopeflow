/**
 * Model providers behind one small interface, so the rest of the AI code never knows which model
 * answered. Order: Cloudflare Workers AI (free daily allowance, same account as the site, no key),
 * then Gemini only if GEMINI_API_KEY is set (used when Cloudflare fails or its daily allowance is
 * spent). A mock provider answers in tests and local end-to-end runs.
 *
 * Costs: Workers AI on the Workers Free plan stops with an error at the daily allowance instead of
 * billing. Gemini's free tier also stops at its rate limits; Google may use free-tier prompts to
 * improve its products, so it is off unless the owner adds the key on purpose.
 */

export type Message = { role: "system" | "user" | "assistant"; content: string };
export type GenerateRequest = { messages: Message[]; maxTokens: number; jsonSchema?: Record<string, unknown> };
export type GenerateResult = { text: string; provider: string };

export interface Provider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** The Workers AI binding (env.AI): `run(model, inputs)`. */
export type WorkersAi = { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };

export const DEFAULT_CF_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** True when it is worth trying the next provider (quota, capacity, timeout, bad answer). */
    readonly retryable = true,
  ) {
    super(message);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, provider: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError(`timed out after ${ms} ms`, provider)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export function cloudflareProvider(ai: WorkersAi, model = DEFAULT_CF_MODEL, timeoutMs = 45_000): Provider {
  const name = `cloudflare:${model.replace(/^@cf\//, "")}`;
  return {
    name,
    async generate({ messages, maxTokens, jsonSchema }) {
      const run = (schema?: Record<string, unknown>) =>
        withTimeout(
          ai.run(model, {
            messages,
            max_tokens: maxTokens,
            temperature: 0.2,
            ...(schema ? { response_format: { type: "json_schema", json_schema: schema } } : {}),
          }),
          timeoutMs,
          name,
        );
      let out: unknown;
      try {
        try {
          out = await run(jsonSchema);
        } catch (e) {
          // Some models reject a schema they can't follow (JSON mode); the prompt carries the schema too.
          if (!jsonSchema || e instanceof ProviderError || /daily|quota|allocation|capacity|4006|3036/i.test(String(e))) throw e;
          out = await run();
        }
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        throw new ProviderError(e instanceof Error ? e.message : String(e), name);
      }
      const r = (out ?? {}) as { response?: unknown };
      const text = typeof r.response === "string" ? r.response : r.response && typeof r.response === "object" ? JSON.stringify(r.response) : "";
      if (!text) throw new ProviderError("empty answer", name);
      return { text, provider: name };
    },
  };
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export function geminiProvider(apiKey: string, model = DEFAULT_GEMINI_MODEL, f: Fetcher = fetch, timeoutMs = 45_000): Provider {
  const name = `gemini:${model}`;
  return {
    name,
    async generate({ messages, maxTokens, jsonSchema }) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const res = await withTimeout(
        f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, ...(jsonSchema ? { responseMimeType: "application/json" } : {}) },
          }),
        }),
        timeoutMs,
        name,
      );
      if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, name, res.status === 429 || res.status >= 500);
      const body = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
      const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) throw new ProviderError("empty answer", name);
      return { text, provider: name };
    },
  };
}

/** Tries each provider in order; the first good answer wins. */
export function chain(providers: Provider[]): Provider {
  if (!providers.length) throw new Error("No AI provider configured");
  return {
    name: providers.map((p) => p.name).join(" → "),
    async generate(req) {
      let last: unknown;
      for (const p of providers) {
        try {
          return await p.generate(req);
        } catch (e) {
          last = e;
          console.error(`ai: ${p.name} failed: ${e instanceof Error ? e.message : String(e)}`);
          if (e instanceof ProviderError && !e.retryable) break;
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}

/**
 * Deterministic answers for tests and local end-to-end runs (AI_PROVIDER=mock). It reads the task
 * from the system prompt's first line ("TASK: scope_draft") and echoes facts from the request, so
 * tests can check that context and guards are wired correctly. Never used in production.
 */
export function mockProvider(): Provider {
  return {
    name: "mock",
    async generate({ messages }) {
      const task = /TASK: (\w+)/.exec(messages[0]?.content ?? "")?.[1];
      const user = messages.filter((m) => m.role === "user").pop()?.content ?? "";
      const text = JSON.stringify(mockAnswer(task, user));
      return { text, provider: "mock" };
    },
  };
}

function mockAnswer(task: string | undefined, user: string): unknown {
  if (task === "scope_draft") {
    return {
      title: "Brand kit for Chai & Co.",
      summary: "A small brand identity for a new café: logo, colours and the basics needed to open.",
      clientName: /chai/i.test(user) ? "Chai & Co." : null,
      budget: 40000,
      deliverables: [
        { title: "Primary logo", description: "Two concepts, one refined. SVG, PNG and PDF.", revisions: 3, amount: 25000 },
        { title: "Colour palette and type", description: "Up to 5 colours and 2 typefaces with usage notes.", revisions: 1, amount: 99999 },
        { title: "Menu card", description: "One A4 menu, print-ready.", revisions: 2, amount: null },
      ],
      exclusions: ["Printing costs", "Copywriting", "Photography"],
      assumptions: ["The client supplies the menu text and prices."],
      dependencies: ["Café name and any existing logo files"],
      risks: [{ risk: "Menu prices change during design", mitigation: "Freeze menu text before layout starts" }],
      phases: [
        { name: "Discovery", estimate: "2 days", deliverables: [] },
        { name: "Logo", estimate: "1 week", deliverables: ["Primary logo"] },
      ],
      paymentSplit: [
        { title: "Advance", percent: 50 },
        { title: "On delivery", percent: 50 },
      ],
      terms: "50% advance before work starts. Final files after full payment.",
      extraRevisionPrice: 1500,
      missingInfo: [{ question: "Do they need social media templates?", why: "Often requested after the logo is approved." }],
    };
  }
  if (task === "change_impact") {
    return {
      kind: /logo|colou?r|font/i.test(user) && !/video|reel|page/i.test(user) ? "uses_revision" : "new_work",
      explanation: "This asks for work that isn't in the approved scope.",
      affectedDeliverables: [],
      newWork: [{ title: "Extra item", description: "As requested by the client.", quantity: 1, unit: null }],
      timelineImpact: "Adds work after the current deliverables; the due date would move unless it runs in parallel.",
      questionsForClient: ["When do you need it by?"],
      clientMessage: "Happy to do this. It's outside what we agreed, so I'll send a small change order to approve first.",
    };
  }
  return {
    intent: "status",
    answer: "Here is where things stand.\n- 1 approval waiting\n- 1 payment due",
    sources: [],
    actions: [],
    draft: null,
  };
}
