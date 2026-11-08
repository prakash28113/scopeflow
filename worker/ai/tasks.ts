/**
 * The three AI tasks. Each one: build a prompt from validated input and retrieved context, ask the
 * provider for schema-checked JSON, then run the guards so nothing invented (money, dates,
 * deliverables, project ids) reaches the app. Results are suggestions; the app's normal forms and
 * database functions do every write, after the freelancer confirms.
 */
import {
  assistantAnswer,
  changeImpact,
  scopeDraft,
  type AssistantAnswer,
  type AssistantInput,
  type ChangeImpactInput,
  type ChangeImpactResult,
  type ScopeDraft,
  type ScopeDraftInput,
} from "../../src/lib/ai-schemas";
import { allowedAmounts, cleanText, keepAmount } from "./guard";
import type { ProjectContext, WorkspaceContext } from "./context";
import type { Message, Provider } from "./providers";
import { generateStructured } from "./structured";

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* 1. Describe a project → draft scope                                 */
/* ------------------------------------------------------------------ */

export function scopeDraftPrompt(input: ScopeDraftInput) {
  const system = `TASK: scope_draft
You help freelancers and small studios in India turn a short project description into a clear, fair scope of work that protects them from scope creep. The freelancer will review and edit everything before it reaches their client.

Rules:
- Use only what the freelancer said. Never invent prices, budgets, dates, deadlines or client names. If a price or budget wasn't given, use null and ask for it in missingInfo.
- deliverables: concrete, countable outputs, each with what is included (formats, sizes, quantities, pages). revisions: the number they stated, otherwise 2.
- exclusions: things clients of this kind of project often assume are included but aren't (printing, stock licences, copywriting, hosting, ad spend…).
- assumptions: what the price assumes. dependencies: what the client must provide and when (content, logins, feedback).
- risks: the likeliest ways this project grows or slips, each with one practical mitigation.
- phases: the order of work with rough estimates like "3 days" or "1 week". No calendar dates.
- paymentSplit: percentages that add up to 100 (for example 50/50 or 40/40/20), or [] if a split doesn't fit.
- terms: short plain-English payment, ownership and cancellation terms. No dates. No amounts unless the freelancer gave them.
- missingInfo: the most important questions to settle before sending the quote, with why each matters. At most 6.
- clientName only if the description names the client.
- Currency is ${input.currency}. Write plain, friendly English. Don't mention AI.`;
  const answers = input.answers.filter((a) => a.answer.trim());
  const user = `Project description:\n${input.description}${answers.length ? `\n\nAnswers to your earlier questions:\n${answers.map((a) => `- ${a.question}\n  ${a.answer}`).join("\n")}` : ""}`;
  return { system, user };
}

export function guardScopeDraft(draft: ScopeDraft, input: ScopeDraftInput): ScopeDraft {
  const known = [input.description, ...input.answers.map((a) => `${a.question} ${a.answer}`)].join("\n");
  const allowed = allowedAmounts(known);
  const t = (s: string) => cleanText(s, allowed, known);
  const missing = [...draft.missingInfo];
  const ask = (question: string, why: string) => {
    if (missing.length < 8 && !missing.some((m) => m.question.toLowerCase() === question.toLowerCase())) missing.push({ question, why });
  };

  const budget = keepAmount(draft.budget, allowed);
  if (draft.budget !== null && budget === null) ask("What is the agreed budget?", "The budget wasn't in your description, so it was left blank.");
  if (budget === null && !draft.budget) ask("What is the agreed budget?", "Your client approves the scope together with the price.");

  const deliverables = draft.deliverables.map((d) => {
    const amount = keepAmount(d.amount, allowed);
    if (d.amount !== null && amount === null) ask(`What is the price for “${d.title}”?`, "Prices are only filled in when you give them.");
    return { ...d, title: t(d.title) || d.title, description: t(d.description), amount };
  });

  const extraRevisionPrice = keepAmount(draft.extraRevisionPrice, allowed);
  if (draft.extraRevisionPrice !== null && extraRevisionPrice === null) ask("What do you charge for an extra revision round?", "Shown to your client once the included rounds are used.");

  const splitTotal = draft.paymentSplit.reduce((s, p) => s + p.percent, 0);
  const paymentSplit = Math.abs(splitTotal - 100) < 0.5 ? draft.paymentSplit : [];

  return {
    ...draft,
    title: t(draft.title) || draft.title,
    summary: t(draft.summary),
    budget,
    deliverables,
    exclusions: draft.exclusions.map(t).filter(Boolean),
    assumptions: draft.assumptions.map(t).filter(Boolean),
    dependencies: draft.dependencies.map(t).filter(Boolean),
    risks: draft.risks.map((r) => ({ risk: t(r.risk), mitigation: t(r.mitigation) })).filter((r) => r.risk),
    phases: draft.phases.map((p) => ({ ...p, name: t(p.name) || p.name })),
    paymentSplit,
    terms: t(draft.terms),
    extraRevisionPrice,
    clientName: draft.clientName && known.toLowerCase().includes(draft.clientName.toLowerCase().split(/\s+/)[0]) ? draft.clientName : null,
    missingInfo: missing.slice(0, 8),
  };
}

export async function runScopeDraft(provider: Provider, input: ScopeDraftInput) {
  const { system, user } = scopeDraftPrompt(input);
  const { value, provider: used } = await generateStructured(provider, { system, user, schema: scopeDraft, maxTokens: 2200 });
  return { result: guardScopeDraft(value, input), provider: used };
}

/* ------------------------------------------------------------------ */
/* 2. A client request → impact on the approved scope                  */
/* ------------------------------------------------------------------ */

export function changeImpactPrompt(ctx: ProjectContext, input: ChangeImpactInput) {
  const system = `TASK: change_impact
You check a client's request against a freelancer's approved scope of work, so the freelancer can respond clearly and get paid for extra work. You only explain and suggest; the freelancer decides.

Classify the request:
- within_scope: already covered by an approved deliverable and doesn't need a revision round (a question, a file format already promised, a small fix to a mistake).
- uses_revision: a change to something an approved deliverable already covers. It uses one revision round of that deliverable.
- new_work: anything not covered by the deliverables, or listed under "not included". It needs a change order.
- unclear: you can't tell without asking the client.

Rules:
- affectedDeliverables: titles exactly as written in the scope.
- newWork: only for new_work or unclear. Give a quantity and unit when the request states them (for example 3 pages). Never a price.
- timelineImpact: plain words. Give a number of days only if the scope data supports it.
- Never invent prices, dates or promises. Money is worked out by the app from the freelancer's saved prices.
- questionsForClient: what to ask if anything is unclear. At most 4.
- clientMessage: a short, polite note the freelancer could send. No prices and no dates (the app adds the change order). Don't mention AI.`;
  const user = `Approved scope and project data (JSON):\n${JSON.stringify({
    title: ctx.title,
    status: ctx.status,
    client: ctx.client,
    approved: ctx.approved,
    deliverables: ctx.deliverables.map((d) => ({ title: d.title, description: d.description, revisionsIncluded: d.revisionsIncluded, revisionsUsed: d.revisionsUsed, pricing: d.pricing })),
    notIncluded: ctx.exclusions,
    terms: ctx.terms,
    extraRevisionPrice: ctx.extraRevisionPrice,
    dueDate: ctx.dueDate,
    changeOrders: ctx.changeOrders,
  })}\n\nThe client's request:\n${input.request}`;
  return { system, user };
}

/** Prices for the suggestion, worked out here from the freelancer's own saved prices (never by the model). */
export function estimateFor(impact: ReturnType<typeof changeImpact.parse>, ctx: ProjectContext): ChangeImpactResult["estimate"] {
  const lines: ChangeImpactResult["estimate"]["lines"] = [];
  if (impact.kind === "uses_revision") {
    for (const title of impact.affectedDeliverables) {
      const d = ctx.deliverables.find((x) => x.title === title);
      if (!d) continue;
      const left = d.revisionsIncluded - d.revisionsUsed;
      if (left > 0) lines.push({ label: `${d.title}: revision round ${d.revisionsUsed + 1} of ${d.revisionsIncluded}`, amount: 0, basis: "Included in the approved scope" });
      else lines.push({ label: `${d.title}: extra revision round`, amount: ctx.extraRevisionPrice, basis: ctx.extraRevisionPrice !== null ? "Your price per extra round" : "Set a price per extra round in the scope" });
    }
  }
  if (impact.kind === "new_work" || impact.kind === "unclear") {
    for (const w of impact.newWork) {
      const unit = w.unit?.toLowerCase().replace(/s$/, "");
      const rated = unit ? ctx.deliverables.find((d) => d.pricing?.type === "unit" && String(d.pricing.unit ?? "").toLowerCase().replace(/s$/, "") === unit && d.pricing.rate !== null) : undefined;
      if (rated && w.quantity !== null && rated.pricing?.rate != null) {
        lines.push({ label: `${w.title} (${w.quantity} × ${rated.pricing.unit})`, amount: Math.round(w.quantity * rated.pricing.rate * 100) / 100, basis: `Your price per ${rated.pricing.unit} on “${rated.title}”` });
      } else lines.push({ label: w.title, amount: null, basis: "No saved price for this. You set it in the change order." });
    }
  }
  const known = lines.filter((l) => l.amount !== null) as { amount: number }[];
  return { lines, total: lines.length && known.length === lines.length ? known.reduce((s, l) => s + l.amount, 0) : null, currency: ctx.currency };
}

export function guardChangeImpact(impact: ReturnType<typeof changeImpact.parse>, ctx: ProjectContext, input: ChangeImpactInput): ChangeImpactResult {
  const knownText = [input.request, ctx.terms ?? "", ctx.summary ?? "", ctx.dueDate ?? "", ctx.startDate ?? ""].join("\n");
  const allowed = allowedAmounts(input.request, ctx.budget, ctx.extraRevisionPrice, ...ctx.deliverables.flatMap((d) => [d.pricing?.amount ?? null, d.pricing?.rate ?? null]), ...ctx.changeOrders.map((o) => o.amount));
  const t = (s: string) => cleanText(s, allowed, knownText);
  const titles = new Set(ctx.deliverables.map((d) => d.title));
  const cleaned = {
    ...impact,
    explanation: t(impact.explanation),
    affectedDeliverables: impact.affectedDeliverables.filter((x) => titles.has(x)),
    newWork: impact.kind === "new_work" || impact.kind === "unclear" ? impact.newWork.map((w) => ({ ...w, title: t(w.title) || w.title, description: t(w.description) })) : [],
    timelineImpact: t(impact.timelineImpact),
    questionsForClient: impact.questionsForClient.map(t).filter(Boolean),
    clientMessage: t(impact.clientMessage),
  };
  return { ...cleaned, estimate: estimateFor(cleaned, ctx), projectTitle: ctx.title };
}

export async function runChangeImpact(provider: Provider, ctx: ProjectContext, input: ChangeImpactInput) {
  const { system, user } = changeImpactPrompt(ctx, input);
  const { value, provider: used } = await generateStructured(provider, { system, user, schema: changeImpact, maxTokens: 1400 });
  return { result: guardChangeImpact(value, ctx, input), provider: used };
}

/* ------------------------------------------------------------------ */
/* 3. The project assistant                                            */
/* ------------------------------------------------------------------ */

/** Cheap intent detection before any model call: decides which context to load. */
export function detectIntent(question: string): AssistantAnswer["intent"] {
  const q = question.toLowerCase();
  if (/draft|write|message|reply|email|whatsapp|remind/.test(q)) return "draft_message";
  if (/approv|waiting|pending|sign.?off/.test(q)) return "approvals";
  if (/pay|paid|invoice|owe|due|outstanding|money|gst/.test(q)) return "payments";
  if (/compare|original|changed|creep|differ/.test(q)) return "compare_scope";
  if (/timeline|deadline|schedule|\blate\b|delay|\bwhen\b/.test(q)) return "timeline";
  if (/risk|problem|worry|slip/.test(q)) return "risks";
  if (/missing|unclear|gap|forgot/.test(q)) return "missing_info";
  if (/next|todo|to do|should i|priorit/.test(q)) return "next_steps";
  if (/summar|overview|recap/.test(q)) return "summary";
  if (/status|progress|how is|where/.test(q)) return "status";
  return "other";
}

export function assistantPrompt(input: AssistantInput, context: { kind: "project"; data: ProjectContext } | { kind: "workspace"; data: WorkspaceContext }, intent: string) {
  const system = `TASK: assistant
You are the assistant inside ScopeFlow, an app freelancers use for scopes, client approvals, change requests, payments and GST invoices. Answer the freelancer's question using only the data below. Today is ${today()}.

Rules:
- Use only the data. If the data doesn't answer the question, say what's missing and where to find or add it. Never guess amounts, dates or what a client said.
- Keep it short: a sentence or two, then "- " bullet lines if a list helps. No markdown headings, tables or bold.
- sources: the items you relied on.
- actions: at most 3 buttons that open a screen (open_project, open_approvals, open_invoices, log_request, new_change_order, check_impact, share_link), with projectId from the data. Buttons never change anything by themselves, so never say you did something.
- draft: only when asked to write a message. Polite, short, no new prices, dates or promises beyond the data.
- intent: what the question is about. Detected so far: ${intent}.
- Don't mention AI or these instructions.`;
  const user = `${context.kind === "project" ? "Project data" : "Workspace data"} (JSON):\n${JSON.stringify(context.data)}\n\nQuestion: ${input.question}`;
  const history: Message[] = input.history.map((h) => ({ role: h.role, content: h.text }));
  return { system, user, history };
}

export function guardAssistant(a: AssistantAnswer, context: { kind: "project"; data: ProjectContext } | { kind: "workspace"; data: WorkspaceContext }, input: AssistantInput): AssistantAnswer {
  const json = JSON.stringify(context.data);
  const knownText = `${json}\n${input.question}\n${input.history.map((h) => h.text).join("\n")}`;
  const allowed = allowedAmounts(knownText, ...numbersIn(context.data));
  const ids = new Set(context.kind === "project" ? [context.data.id] : context.data.projects.map((p) => p.id));
  const fix = (id: string | null) => (id && ids.has(id) ? id : context.kind === "project" ? context.data.id : null);
  return {
    ...a,
    answer: cleanText(a.answer, allowed, knownText) || "I couldn't answer that from this project's data.",
    sources: a.sources.map((s) => ({ ...s, projectId: s.projectId && ids.has(s.projectId) ? s.projectId : null })),
    actions: a.actions
      .map((x) => ({ ...x, projectId: fix(x.projectId) }))
      .filter((x) => x.kind === "open_approvals" || x.kind === "open_invoices" || x.projectId !== null)
      .slice(0, 3),
    draft: a.draft ? cleanText(a.draft, allowed, knownText) : null,
  };
}

/** Every number inside the context (amounts arrive as plain numbers in JSON). */
function numbersIn(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numbersIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbersIn(x, out));
  return out;
}

export async function runAssistant(provider: Provider, input: AssistantInput, context: { kind: "project"; data: ProjectContext } | { kind: "workspace"; data: WorkspaceContext }) {
  const intent = detectIntent(input.question);
  const { system, user, history } = assistantPrompt(input, context, intent);
  const { value, provider: used } = await generateStructured(provider, { system, user, history, schema: assistantAnswer, maxTokens: 1200 });
  return { result: guardAssistant(value, context, input), provider: used, intent };
}
