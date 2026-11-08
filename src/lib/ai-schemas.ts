/**
 * The shapes AI suggestions must have. The Worker validates every model answer against these
 * before it reaches the app, and the app validates again before showing it. Pure: the Worker
 * imports it too.
 *
 * Rules the shapes encode:
 *  - suggestions only: nothing here is saved until the freelancer confirms it in the normal form;
 *  - no calendar dates (a model must not invent deadlines): timelines are rough estimates;
 *  - money is null unless the freelancer gave it (the Worker strips any amount it can't trace to
 *    their own words or their saved prices, see worker/ai/guard.ts).
 */
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const line = text(200);
const money = z.number().finite().nonnegative().max(1_000_000_000).nullable();

export const AI_TASKS = ["scope_draft", "change_impact", "assistant"] as const;
export type AiTask = (typeof AI_TASKS)[number];

/* ---------------- 1. Describe a project → draft scope ---------------- */

export const scopeDraftInput = z.object({
  description: z.string().trim().min(12, "Describe the project in a sentence or two.").max(4000),
  /** Answers to the follow-up questions from an earlier draft. */
  answers: z.array(z.object({ question: text(300), answer: text(600) })).max(10).default([]),
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
});
export type ScopeDraftInput = z.infer<typeof scopeDraftInput>;

export const scopeDraft = z.object({
  title: text(120).min(1),
  summary: text(700),
  clientName: text(120).nullable(),
  budget: money,
  deliverables: z
    .array(
      z.object({
        title: text(120).min(1),
        description: text(500),
        revisions: z.number().int().min(0).max(10),
        amount: money,
      }),
    )
    .min(1)
    .max(12),
  exclusions: z.array(line).max(12),
  assumptions: z.array(line).max(10),
  /** What the freelancer needs from the client (content, logins, approvals…). */
  dependencies: z.array(line).max(8),
  risks: z.array(z.object({ risk: line, mitigation: line })).max(6),
  /** Rough order of work. Estimates, never dates. */
  phases: z.array(z.object({ name: text(80), estimate: text(40), deliverables: z.array(text(120)).max(12) })).max(8),
  /** A suggested payment split in percent. Amounts are only worked out when the budget is known. */
  paymentSplit: z.array(z.object({ title: text(80), percent: z.number().min(1).max(100) })).max(5),
  terms: text(700),
  extraRevisionPrice: money,
  missingInfo: z.array(z.object({ question: text(240), why: text(240) })).max(8),
});
export type ScopeDraft = z.infer<typeof scopeDraft>;

/* ---------------- 2. A client request → impact on the approved scope ---------------- */

export const changeImpactInput = z.object({
  projectId: z.string().uuid(),
  /** The client's words: a logged request, or "what if they want three more pages?" */
  request: z.string().trim().min(4, "Write what the client asked for.").max(2000),
  /** An existing revision request to analyse (optional). */
  requestId: z.string().uuid().nullable().default(null),
});
export type ChangeImpactInput = z.infer<typeof changeImpactInput>;

export const IMPACT_KINDS = ["within_scope", "uses_revision", "new_work", "unclear"] as const;

export const changeImpact = z.object({
  kind: z.enum(IMPACT_KINDS),
  /** One or two plain sentences the freelancer could also send to the client. */
  explanation: text(700),
  /** Approved deliverables this request touches (titles exactly as in the scope). */
  affectedDeliverables: z.array(text(120)).max(12),
  /** Work that isn't in the approved scope. Quantities only; prices come from saved rates. */
  newWork: z.array(z.object({ title: text(120), description: text(400), quantity: z.number().min(0).max(1000).nullable(), unit: text(24).nullable() })).max(8),
  /** Qualitative unless the freelancer's own data gives a number. */
  timelineImpact: text(400),
  questionsForClient: z.array(text(240)).max(6),
  /** A short draft message to the client. The freelancer edits and sends it themselves. */
  clientMessage: text(1200),
});
export type ChangeImpact = z.infer<typeof changeImpact>;

/** What the app receives: the model's analysis plus prices worked out from the freelancer's saved prices. */
export const changeImpactResult = changeImpact.extend({
  projectTitle: text(200),
  estimate: z.object({
    lines: z.array(z.object({ label: text(240), amount: money, basis: text(200) })).max(20),
    /** Null unless every line has a known price. */
    total: money,
    currency: z.string(),
  }),
});
export type ChangeImpactResult = z.infer<typeof changeImpactResult>;

/* ---------------- 3. The project assistant ---------------- */

export const assistantInput = z.object({
  question: z.string().trim().min(2).max(1000),
  /** Ask about one project, or about the whole workspace when null. */
  projectId: z.string().uuid().nullable().default(null),
  /** The last few turns, for follow-up questions. */
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: text(2000) })).max(8).default([]),
});
export type AssistantInput = z.infer<typeof assistantInput>;

export const ASSISTANT_INTENTS = ["summary", "status", "approvals", "payments", "timeline", "risks", "next_steps", "draft_message", "missing_info", "compare_scope", "other"] as const;
export const ASSISTANT_ACTIONS = ["open_project", "open_approvals", "open_invoices", "log_request", "new_change_order", "check_impact", "share_link"] as const;

export const assistantAnswer = z.object({
  intent: z.enum(ASSISTANT_INTENTS),
  /** Plain text, short paragraphs and "- " bullet lines only. */
  answer: text(2500).min(1),
  /** Things the answer relied on, so the freelancer can check them. */
  sources: z.array(z.object({ kind: z.enum(["project", "request", "change_order", "milestone", "invoice", "approval"]), label: text(160), projectId: z.string().uuid().nullable() })).max(10),
  /** Buttons that open the normal screens. They never change anything by themselves. */
  actions: z.array(z.object({ kind: z.enum(ASSISTANT_ACTIONS), label: text(60), projectId: z.string().uuid().nullable() })).max(4),
  /** A message draft when one was asked for. */
  draft: text(1500).nullable(),
});
export type AssistantAnswer = z.infer<typeof assistantAnswer>;

/* ---------------- Transport ---------------- */

export type AiResult<T> =
  | { ok: true; result: T; provider: string; remaining: number | null }
  | { ok: false; error: string; code: "off" | "auth" | "limit" | "invalid" | "busy" | "failed" | "forbidden" };
