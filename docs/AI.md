# AI suggestions

ScopeFlow's AI is an assistant inside the normal screens, not a separate chatbot. It suggests;
the freelancer decides. The database stays the source of truth, and nothing the AI says changes a
project until the freelancer saves it through the usual forms.

## What it does

| Where | What the freelancer does | What comes back |
| --- | --- | --- |
| New project → **Describe the project** | Writes the project in plain words ("Brand kit for a café, 3 rounds, ₹40,000") | A suggested scope: deliverables, revision rounds, what's not included, assumptions, what's needed from the client, risks, a rough order of work, a payment split and the questions to settle. They untick what they don't want, answer questions to refine it, then **Use in the form**. The form still has to be saved. |
| Project → each client request → **Check against the scope**, or **What if they ask for more?** | Uses the client's words, or types a "what if" | Whether it's covered, uses a revision round, or is new work; which deliverables it touches; the cost at the freelancer's own saved prices; timeline impact in plain words; questions for the client; a reply they could send. **Draft change order** opens the normal change-order form filled in; the freelancer checks and sends it. |
| Project and dashboard → **Ask about…** | Asks "Summarize the status", "What's waiting on me?", "Who owes me money?", "Draft a payment reminder", follow-ups… | A short answer from their data, what it was based on, buttons that open the right screen, and a message draft when asked. |

Conventional controls are always there: every field can be filled by hand, and AI features are
hidden entirely when switched off.

## Rules it follows

- **No invented money, dates or commitments.** After the model answers, `worker/ai/guard.ts` keeps an
  amount only if the same number appears in what the freelancer wrote or in their saved data, and
  otherwise asks for it. Money in free text that can't be traced becomes "[price to confirm]", and a
  sentence naming a calendar date the freelancer never gave is dropped. Change-order prices are
  worked out by the app from saved prices, never by the model.
- **Validated structured output.** Every answer must match a schema in `src/lib/ai-schemas.ts`
  (checked in the Worker, with one retry, and again in the browser). Deliverable names and project
  ids that aren't in the data are removed.
- **Context isolation and permissions.** The Worker reads data with the signed-in user's own token, so
  database security rules decide what the AI can see. `ai_begin()` also checks that the project
  belongs to the caller.
- **Audit history.** `ai_requests` records each request (task, project, provider, success). Prompts
  and answers are not stored. Changes the freelancer makes afterwards go through the normal
  functions and the project timeline.
- **Daily allowance.** 30 suggestions per account per day (India time), to share the free capacity
  fairly.

## How it's built

```
browser ──POST /api/ai/{scope-draft|change-impact|assistant}──▶ Worker (worker/ai/handler.ts)
  1. switched on? (AI_ACCESS)        2. same origin, JSON, size
  3. session → Supabase /auth/v1/user 4. ai_begin(): allowance + ownership + audit row
  5. input schema (src/lib/ai-schemas.ts)
  6. context with the user's token (worker/ai/context.ts)
  7. intent detection for the assistant (tasks.ts detectIntent)
  8. provider chain (worker/ai/providers.ts): Workers AI → Gemini (if a key is set)
  9. structured output + schema check + retry (worker/ai/structured.ts)
 10. guards (worker/ai/guard.ts) and prices from saved rates (tasks.ts estimateFor)
 11. ai_finish() closes the audit row ──▶ suggestion back to the browser
```

Providers sit behind one small interface, so another model or service can be added without
touching the tasks.

## Costs and limits

- **Cloudflare Workers AI** (default): included in the Cloudflare account ScopeFlow already uses.
  10,000 free "neurons" a day, which is roughly 60–150 suggestions a day across all users with the
  default model (`@cf/meta/llama-4-scout-17b-16e-instruct`). On the Workers Free plan it **stops with
  an error** when the allowance is used up; it never bills. Cloudflare doesn't use the content to
  train models or keep it after answering.
- **Gemini** (optional fallback): used only if the `GEMINI_API_KEY` secret is set, when Workers AI
  fails or its daily allowance is spent. The free tier has rate limits and **Google may use free-tier
  requests to improve its products**; the privacy policy says so. Leave the secret unset to never
  send anything to Google.
- When both are unavailable, the app says so and the freelancer fills the form by hand.

## Switching it on

Nothing is on by default. In GitHub → Settings → Secrets and variables → Actions:

1. **Variables → `AI_ACCESS`**: your own account email first (to try it), later `all`. Empty or
   `off` turns AI off.
2. Optional **Variables → `AI_MODEL`**: another Workers AI text model.
3. Optional **Secrets → `GEMINI_API_KEY`**: a key from Google AI Studio for the fallback. To stop
   using it later, delete the secret and remove it from the Worker (Cloudflare → Workers →
   scopeflow → Settings → Variables and secrets).
4. Run **Actions → Release** (this applies the `ai_requests` migration and deploys).

The release adds the Workers AI binding at deploy time (`.wrangler-deploy.json`), so local and CI
runs don't need a Cloudflare login. If the deploy reports a permissions error for Workers AI, add
**Account → Workers AI → Read** to the `CLOUDFLARE_API_TOKEN`.

## Tests

- `tests/unit/ai.test.ts`: guards, structured output and retry, provider fallback, handler checks,
  draft-to-form mapping.
- `tests/db/ai-requests.test.ts`: allowance, ownership, permissions, rollback.
- `tests/e2e/workflow.mjs`: the three features in the browser, on Cloudflare's runtime, with a mock
  provider (`AI_PROVIDER=mock`, honoured only with a local database).
