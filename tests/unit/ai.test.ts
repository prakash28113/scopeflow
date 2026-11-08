import { describe, expect, it } from "vitest";
import { allowedAmounts, amountsIn, cleanText, dropInventedDates, keepAmount, scrubMoney } from "../../worker/ai/guard";
import { extractJson, generateStructured } from "../../worker/ai/structured";
import { chain, cloudflareProvider, geminiProvider, mockProvider, ProviderError, type Provider } from "../../worker/ai/providers";
import { detectIntent, estimateFor, guardAssistant, guardChangeImpact, guardScopeDraft } from "../../worker/ai/tasks";
import { allowed, providerFor, serveAi } from "../../worker/ai/handler";
import { scopeDraft, scopeDraftInput, changeImpactResult, assistantAnswer } from "../../src/lib/ai-schemas";
import type { ProjectContext } from "../../worker/ai/context";
import { draftToForm, selectAll, splitAmounts } from "../../src/lib/ai-apply";

describe("guards", () => {
  it("reads amounts the way Indian freelancers write them", () => {
    expect(amountsIn("Budget ₹40,000 for the logo")).toContain(40000);
    expect(amountsIn("about 40k")).toContain(40000);
    expect(amountsIn("1.5 lakh total, 1,50,000")).toEqual(expect.arrayContaining([150000]));
    expect(amountsIn("2 cr")).toContain(20000000);
  });

  it("keeps only amounts the freelancer gave", () => {
    const a = allowedAmounts("Logo ₹25,000, total 40k");
    expect(keepAmount(25000, a)).toBe(25000);
    expect(keepAmount(40000, a)).toBe(40000);
    expect(keepAmount(99999, a)).toBeNull();
    expect(keepAmount(null, a)).toBeNull();
  });

  it("scrubs invented money and invented dates from text", () => {
    const a = allowedAmounts("₹1,500 per extra round");
    expect(scrubMoney("Extra rounds cost ₹1,500. Rush fee ₹5,000.", a)).toBe("Extra rounds cost ₹1,500. Rush fee [price to confirm].");
    expect(dropInventedDates("Logo first. Final files by 15 December 2026. Then the menu.", "client wants it soon")).toBe("Logo first. Then the menu.");
    expect(dropInventedDates("Launch on 2026-12-01.", "launch is 2026-12-01")).toBe("Launch on 2026-12-01.");
    expect(cleanText("Pay ₹9,999 by 3 Jan.", new Set(), "")).toBe("");
  });
});

describe("structured answers", () => {
  it("pulls JSON out of fenced or chatty answers", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("no json")).toThrow();
  });

  it("retries once with the validation errors, then gives up", async () => {
    const answers = ['{"title": ""}', JSON.stringify(validDraft())];
    const seen: string[] = [];
    const p: Provider = { name: "fake", async generate({ messages }) { seen.push(messages[messages.length - 1].content); return { text: answers.shift() ?? "{}", provider: "fake" }; } };
    const out = await generateStructured(p, { system: "TASK: scope_draft", user: "x", schema: scopeDraft, maxTokens: 100 });
    expect(out.value.title).toBe("Brand kit");
    expect(seen[1]).toMatch(/didn't match the schema/);
    const bad: Provider = { name: "bad", async generate() { return { text: "nope", provider: "bad" }; } };
    await expect(generateStructured(bad, { system: "", user: "x", schema: scopeDraft, maxTokens: 100 })).rejects.toThrow(/didn't match/);
  });
});

describe("providers", () => {
  it("falls back to Gemini when Workers AI is out of its daily allowance", async () => {
    const cf = cloudflareProvider({ run: async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); } });
    const calls: string[] = [];
    const gem = geminiProvider("key", "gemini-flash-latest", async (url, init) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("key");
      expect(url).not.toContain("key=");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
    });
    const r = await chain([cf, gem]).generate({ messages: [{ role: "user", content: "hi" }], maxTokens: 10 });
    expect(r).toEqual({ text: '{"ok":true}', provider: "gemini:gemini-flash-latest" });
    expect(calls).toHaveLength(1);
  });

  it("retries Workers AI without JSON mode when a model rejects the schema", async () => {
    const inputs: Record<string, unknown>[] = [];
    const cf = cloudflareProvider({ run: async (_m, i) => { inputs.push(i); if (i.response_format) throw new Error("response_format not supported"); return { response: '{"a":1}' }; } });
    expect((await cf.generate({ messages: [], maxTokens: 5, jsonSchema: { type: "object" } })).text).toBe('{"a":1}');
    expect(inputs).toHaveLength(2);
    const obj = cloudflareProvider({ run: async () => ({ response: { a: 2 } }) });
    expect((await obj.generate({ messages: [], maxTokens: 5 })).text).toBe('{"a":2}');
  });

  it("uses the mock only with a local database, and needs a binding or key otherwise", () => {
    expect(providerFor({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "a", AI_PROVIDER: "mock" })?.name).toBe("mock");
    expect(providerFor({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "a", AI_PROVIDER: "mock" })).toBeNull();
    expect(providerFor({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "a" })).toBeNull();
    expect(providerFor({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "a", AI: { run: async () => ({}) }, GEMINI_API_KEY: "k" })?.name).toMatch(/^cloudflare:.* → gemini:/);
  });

  it("stops the chain on a non-retryable error", async () => {
    let second = false;
    const a: Provider = { name: "a", async generate() { throw new ProviderError("bad key", "a", false); } };
    const b: Provider = { name: "b", async generate() { second = true; return { text: "{}", provider: "b" }; } };
    await expect(chain([a, b]).generate({ messages: [], maxTokens: 1 })).rejects.toThrow("bad key");
    expect(second).toBe(false);
  });
});

function validDraft() {
  return {
    title: "Brand kit", summary: "A logo and basics.", clientName: null, budget: 40000,
    deliverables: [{ title: "Logo", description: "Two concepts.", revisions: 3, amount: 25000 }, { title: "Palette", description: "", revisions: 1, amount: 99999 }],
    exclusions: ["Printing"], assumptions: [], dependencies: [], risks: [], phases: [],
    paymentSplit: [{ title: "Advance", percent: 60 }, { title: "Rest", percent: 30 }],
    terms: "Pay ₹20,000 before 1 Dec.", extraRevisionPrice: 1500, missingInfo: [],
  };
}

describe("scope draft guard", () => {
  it("keeps the freelancer's prices, drops invented ones and asks for them instead", () => {
    const input = scopeDraftInput.parse({ description: "Brand kit for a café, logo for ₹25,000, budget 40k" });
    const g = guardScopeDraft(scopeDraft.parse(validDraft()), input);
    expect(g.budget).toBe(40000);
    expect(g.deliverables.map((d) => d.amount)).toEqual([25000, null]);
    expect(g.extraRevisionPrice).toBeNull();
    expect(g.missingInfo.map((m) => m.question)).toEqual(expect.arrayContaining(["What is the price for “Palette”?", "What do you charge for an extra revision round?"]));
    expect(g.paymentSplit).toEqual([]); // 60 + 30 isn't 100
    expect(g.terms).not.toMatch(/20,000|1 Dec/);
  });

  it("uses answers to follow-up questions as the freelancer's own words", () => {
    const input = scopeDraftInput.parse({ description: "Brand kit for a café, logo and palette", answers: [{ question: "Price for the palette?", answer: "₹99,999 and ₹1,500 per extra round" }] });
    const g = guardScopeDraft(scopeDraft.parse(validDraft()), input);
    expect(g.deliverables[1].amount).toBe(99999);
    expect(g.extraRevisionPrice).toBe(1500);
  });
});

const CTX: ProjectContext = {
  id: "11111111-1111-4111-8111-111111111111", title: "Brand kit for Chai & Co.", status: "active", client: { name: "Meera", company: "Chai & Co." },
  currency: "INR", budget: 40000, approvedExtras: 0, extraRevisionPrice: 1500, startDate: null, dueDate: "2026-11-23", extraDays: 0,
  summary: null, exclusions: "Printing", terms: null, approved: true, latestVersion: 1, latestDecision: "approved",
  deliverables: [
    { title: "Primary logo", description: null, revisionsIncluded: 2, revisionsUsed: 2, progress: null, dueDate: null, pricing: { type: "fixed", amount: 25000, rate: null, hours: null, quantity: null, unit: null } },
    { title: "Social posts", description: null, revisionsIncluded: 2, revisionsUsed: 0, progress: null, dueDate: null, pricing: { type: "unit", amount: null, rate: 2500, hours: null, quantity: 10, unit: "posts" } },
  ],
  requests: [], changeOrders: [], milestones: [],
};

describe("change impact guard", () => {
  it("prices extra rounds and new work from saved prices only", () => {
    const rev = guardChangeImpact({ kind: "uses_revision", explanation: "A logo change.", affectedDeliverables: ["Primary logo", "Made-up deliverable"], newWork: [{ title: "x", description: "", quantity: 1, unit: null }], timelineImpact: "", questionsForClient: [], clientMessage: "Sure, ₹3,000 extra." }, CTX, { projectId: CTX.id, request: "logo tweak", requestId: null });
    expect(rev.affectedDeliverables).toEqual(["Primary logo"]);
    expect(rev.newWork).toEqual([]);
    expect(rev.estimate.lines[0]).toMatchObject({ amount: 1500, basis: "Your price per extra round" });
    expect(rev.clientMessage).toBe("Sure, [price to confirm] extra.");
    expect(changeImpactResult.safeParse(rev).success).toBe(true);

    const nw = guardChangeImpact({ kind: "new_work", explanation: "", affectedDeliverables: [], newWork: [{ title: "More posts", description: "", quantity: 3, unit: "post" }, { title: "A reel", description: "", quantity: 1, unit: "video" }], timelineImpact: "", questionsForClient: [], clientMessage: "" }, CTX, { projectId: CTX.id, request: "3 more posts and a reel", requestId: null });
    expect(nw.estimate.lines.map((l) => l.amount)).toEqual([7500, null]);
    expect(nw.estimate.total).toBeNull();
  });

  it("counts a revision as included while rounds are left", () => {
    const e = estimateFor({ kind: "uses_revision", explanation: "", affectedDeliverables: ["Social posts"], newWork: [], timelineImpact: "", questionsForClient: [], clientMessage: "" }, CTX);
    expect(e.lines[0]).toMatchObject({ amount: 0, label: "Social posts: revision round 1 of 2" });
    expect(e.total).toBe(0);
  });
});

describe("assistant", () => {
  it("detects intent before any model call", () => {
    expect(detectIntent("Show me all pending client approvals")).toBe("approvals");
    expect(detectIntent("Draft a reminder to Meera")).toBe("draft_message");
    expect(detectIntent("Summarize the project status")).toBe("summary");
    expect(detectIntent("Compare the original scope with the latest requirements")).toBe("compare_scope");
  });

  it("drops project ids and amounts that aren't in the data", () => {
    const a = guardAssistant(
      assistantAnswer.parse({ intent: "payments", answer: "₹25,000 is the logo price; ₹77,777 is owed.", sources: [{ kind: "project", label: "x", projectId: "22222222-2222-4222-8222-222222222222" }], actions: [{ kind: "open_project", label: "Open", projectId: "22222222-2222-4222-8222-222222222222" }, { kind: "open_approvals", label: "Approvals", projectId: null }], draft: null }),
      { kind: "project", data: CTX },
      { question: "what's owed?", projectId: CTX.id, history: [] },
    );
    expect(a.answer).toBe("₹25,000 is the logo price; [price to confirm] is owed.");
    expect(a.sources[0].projectId).toBeNull();
    expect(a.actions.map((x) => x.projectId)).toEqual([CTX.id, CTX.id]);
  });
});

describe("handler", () => {
  const SUPA = "http://127.0.0.1:54321";
  const base = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon", AI_PROVIDER: "mock" };
  const req = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost:3000/api/ai/${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer tok", "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  function db(opts: { user?: boolean; limit?: boolean } = {}) {
    const calls: string[] = [];
    const f = async (url: string, init: RequestInit = {}) => {
      calls.push(url.replace(SUPA, ""));
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      if (url.endsWith("/auth/v1/user")) return opts.user === false ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ id: "u1", email: "Priya@Example.com" }));
      if (url.endsWith("/rpc/ai_begin")) return opts.limit ? new Response(JSON.stringify({ message: "You've used today's 30 AI suggestions." }), { status: 400 }) : new Response(JSON.stringify({ id: "r1", remaining: 12 }));
      if (url.endsWith("/rpc/ai_finish")) return new Response("null");
      if (url.endsWith("/rpc/ai_remaining")) return new Response("7");
      return new Response("[]");
    };
    return { f, calls };
  }

  it("ignores other paths and stays off until switched on", async () => {
    expect(await serveAi(new Request("http://localhost/blog"), base)).toBeNull();
    expect((await serveAi(req("status"), { ...base, AI_ACCESS: "" }))!.status).toBe(404);
    expect((await serveAi(req("status"), { ...base, AI_ACCESS: "off" }))!.status).toBe(404);
  });

  it("needs a session, an allowed account and the same origin", async () => {
    expect((await serveAi(req("status", undefined, { authorization: "" }), { ...base, AI_ACCESS: "all" }, db().f))!.status).toBe(401);
    expect((await serveAi(req("status"), { ...base, AI_ACCESS: "all" }, db({ user: false }).f))!.status).toBe(401);
    expect((await serveAi(req("status"), { ...base, AI_ACCESS: "someone@else.com" }, db().f))!.status).toBe(404);
    expect((await serveAi(req("status", undefined, { origin: "https://evil.example" }), { ...base, AI_ACCESS: "all" }, db().f))!.status).toBe(403);
    const ok = await serveAi(req("status"), { ...base, AI_ACCESS: "priya@example.com" }, db().f);
    expect(await ok!.json()).toEqual({ ok: true, enabled: true, remaining: 7 });
    expect(allowed("all", { id: "x", email: null })).toBe(true);
    expect(allowed("U1, a@b.c", { id: "u1", email: null })).toBe(true);
  });

  it("drafts a scope through the allowance, guards and audit", async () => {
    const { f, calls } = db();
    const res = await serveAi(req("scope-draft", { description: "Brand kit for Chai & Co., logo ₹25,000, budget 40k" }), { ...base, AI_ACCESS: "all" }, f);
    const body = (await res!.json()) as { ok: boolean; result: { budget: number; deliverables: { amount: number | null }[]; clientName: string }; remaining: number; provider: string };
    expect(res!.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("mock");
    expect(body.remaining).toBe(12);
    expect(body.result.budget).toBe(40000);
    expect(body.result.deliverables.map((d) => d.amount)).toEqual([25000, null, null]);
    expect(body.result.clientName).toBe("Chai & Co.");
    expect(calls).toEqual(["/auth/v1/user", "/rest/v1/rpc/ai_begin", "/rest/v1/rpc/ai_finish"]);
  });

  it("rejects bad input before spending the allowance, and reports the limit", async () => {
    const { f, calls } = db();
    const bad = await serveAi(req("scope-draft", { description: "logo" }), { ...base, AI_ACCESS: "all" }, f);
    expect(bad!.status).toBe(400);
    expect(calls).not.toContain("/rest/v1/rpc/ai_begin");
    const lim = await serveAi(req("scope-draft", { description: "A full brand kit for a café" }), { ...base, AI_ACCESS: "all" }, db({ limit: true }).f);
    expect(lim!.status).toBe(429);
    expect(((await lim!.json()) as { code: string }).code).toBe("limit");
  });

  it("answers 404 for a project the user can't see", async () => {
    const { f } = db();
    const res = await serveAi(req("change-impact", { projectId: CTX.id, request: "Three more pages please" }), { ...base, AI_ACCESS: "all" }, f);
    expect(res!.status).toBe(404);
  });
});

describe("mock provider", () => {
  it("returns schema-valid answers for every task", async () => {
    const m = mockProvider();
    const draft = await m.generate({ messages: [{ role: "system", content: "TASK: scope_draft" }, { role: "user", content: "chai" }], maxTokens: 1 });
    expect(scopeDraft.safeParse(JSON.parse(draft.text)).success).toBe(true);
    const asst = await m.generate({ messages: [{ role: "system", content: "TASK: assistant" }, { role: "user", content: "?" }], maxTokens: 1 });
    expect(assistantAnswer.safeParse(JSON.parse(asst.text)).success).toBe(true);
  });
});


describe("using a draft in the form", () => {
  const empty = {
    title: "", summary: "", budget: "", client: { name: "", email: "", company: "" },
    deliverables: [{ title: "", description: "", revisions: 2, priceType: "fixed" as const, amount: "", hours: "", rate: "", quantity: "", unit: "", dueDate: "" }],
    milestones: [] as { title: string; amount: string; dueDate: string }[], exclusions: "", terms: "", extraRevision: "", itemised: false, currency: "INR",
  };
  const d = scopeDraft.parse({
    title: "Brand kit", summary: "Logo and basics.", clientName: "Chai & Co.", budget: 40000,
    deliverables: [{ title: "Logo", description: "Two concepts.", revisions: 3, amount: null }, { title: "Palette", description: "", revisions: 1, amount: null }],
    exclusions: ["Printing", "Copywriting"], assumptions: ["Client sends menu text"], dependencies: ["Old logo files"], risks: [], phases: [],
    paymentSplit: [{ title: "Advance", percent: 50 }, { title: "On delivery", percent: 50 }], terms: "Final files after full payment.", extraRevisionPrice: null, missingInfo: [],
  });

  it("fills the form with the picked parts and leaves saving to the freelancer", () => {
    const sel = selectAll(d);
    sel.exclusions[1] = false;
    const f = draftToForm(d, sel, empty);
    expect(f.title).toBe("Brand kit");
    expect(f.client.name).toBe("Chai & Co.");
    expect(f.client.email).toBe("");
    expect(f.deliverables.map((x) => [x.title, x.revisions, x.amount])).toEqual([["Logo", 3, ""], ["Palette", 1, ""]]);
    expect(f.itemised).toBe(false);
    expect(f.budget).toBe("40000");
    expect(f.exclusions).toBe("Printing");
    expect(f.terms).toBe("Final files after full payment.\n\nThis quote assumes:\n- Client sends menu text\n\nWhat we need from you:\n- Old logo files");
    expect(f.milestones).toEqual([{ title: "Advance (50%)", amount: "20000", dueDate: "" }, { title: "On delivery (50%)", amount: "20000", dueDate: "" }]);
    expect(f.currency).toBe("INR");
  });

  it("keeps a client already typed in, itemises when every price is known, and skips the split without a total", () => {
    const priced = scopeDraft.parse({ ...d, budget: null, deliverables: [{ title: "Logo", description: "", revisions: 2, amount: 25000 }, { title: "Menu", description: "", revisions: 2, amount: 15001 }] });
    const f = draftToForm(priced, selectAll(priced), { ...empty, client: { name: "Meera", email: "m@x.in", company: "" } });
    expect(f.client.name).toBe("Meera");
    expect(f.itemised).toBe(true);
    expect(f.milestones.map((m) => m.amount)).toEqual(["20000", "20001"]);
    const none = scopeDraft.parse({ ...d, budget: null });
    expect(draftToForm(none, selectAll(none), empty).milestones).toEqual([]);
    expect(splitAmounts(1000, [33, 33, 34])).toEqual([330, 330, 340]);
  });
});
