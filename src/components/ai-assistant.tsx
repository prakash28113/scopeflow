import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, buttonClass, cx } from "./ui";
import { askAi } from "@/lib/ai";
import { assistantAnswer, type AssistantAnswer } from "@/lib/ai-schemas";

type Turn = { q: string; a: AssistantAnswer };

/** Where an answer's buttons go. They open screens; they never change anything themselves. */
function actionHref(a: AssistantAnswer["actions"][number]): string | null {
  switch (a.kind) {
    case "open_approvals":
      return "/approvals";
    case "open_invoices":
      return "/invoices";
    case "open_project":
    case "share_link":
      return a.projectId ? `/projects/${a.projectId}` : null;
    case "log_request":
    case "check_impact":
      return a.projectId ? `/projects/${a.projectId}#requests` : null;
    case "new_change_order":
      return a.projectId ? `/projects/${a.projectId}/change-orders/new` : null;
  }
}

/** Short paragraphs and "- " bullet lines, as the assistant is asked to write. */
function AnswerText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (last && last.list === bullet && bullet) last.lines.push(line.replace(/^[-•*]\s+/, ""));
    else blocks.push({ list: bullet, lines: [bullet ? line.replace(/^[-•*]\s+/, "") : line] });
  }
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines[0]}</p>
        ),
      )}
    </div>
  );
}

/**
 * Ask a question in plain words about one project or the whole workspace. Answers come only from
 * the freelancer's own data (read with their login), list what they relied on, and offer buttons
 * that open the normal screens. Follow-up questions keep the last few turns.
 */
export function AiAssistant({ projectId = null, title, suggestions }: { projectId?: string | null; title: string; suggestions: string[] }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const qc = useQueryClient();

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 2 || pending) return;
    setPending(true);
    setError(null);
    const history = turns.slice(-3).flatMap((t) => [
      { role: "user" as const, text: t.q },
      { role: "assistant" as const, text: t.a.answer },
    ]);
    const r = await askAi("assistant", { question: text, projectId, history }, assistantAnswer);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setTurns((t) => [...t, { q: text, a: r.result }].slice(-6));
    setQuestion("");
    void qc.invalidateQueries({ queryKey: ["ai-status"] });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]" data-testid="ai-assistant" aria-label={title}>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 p-3.5">
        <label htmlFor={`ask-${projectId ?? "all"}`} className="sr-only">
          {title}
        </label>
        <Input
          id={`ask-${projectId ?? "all"}`}
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={title}
          className="min-w-0 flex-1"
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={pending || question.trim().length < 2}>
          {pending ? "Thinking…" : "Ask"}
        </Button>
      </form>
      {!turns.length && !pending ? (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3.5" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink-2 hover:border-accent hover:text-ink">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="px-3.5 pb-3.5">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {turns.length || pending ? (
        <ol className="space-y-4 border-t border-line px-3.5 py-3.5" aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className="space-y-2" data-testid="ai-answer">
              <p className="text-[13px] font-medium">{t.q}</p>
              <AnswerText text={t.a.answer} />
              {t.a.draft ? (
                <div className="space-y-1.5">
                  <p className="whitespace-pre-line rounded-md bg-sunken/60 p-2.5 text-[13px] text-ink-2">{t.a.draft}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(t.a.draft ?? "")
                        .then(() => setCopied(i))
                        .catch(() => setCopied(null))
                    }
                  >
                    {copied === i ? "Copied" : "Copy message"}
                  </Button>
                </div>
              ) : null}
              {t.a.actions.length ? (
                <div className="flex flex-wrap gap-2">
                  {t.a.actions.map((a, j) => {
                    const href = actionHref(a);
                    return href ? (
                      <Link key={j} to={href} className={buttonClass("secondary", "sm")}>
                        {a.label}
                      </Link>
                    ) : null;
                  })}
                </div>
              ) : null}
              {t.a.sources.length ? (
                <p className="text-[12px] text-muted">
                  Based on: {t.a.sources.map((s) => s.label).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
          {pending ? <li className={cx("h-2 w-1/2 animate-pulse rounded bg-sunken")} aria-label="Thinking" /> : null}
        </ol>
      ) : null}
      {turns.length ? <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-muted">Answers come from your ScopeFlow data and can be wrong. Check before you act or send anything.</p> : null}
    </section>
  );
}
