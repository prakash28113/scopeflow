/**
 * ScopeFlow design system: the shared building blocks every screen uses.
 * Tokens live in styles.css (@theme). Rules of thumb:
 *  - Cobalt is for the one primary action on a screen and "you are here"; everything else is neutral.
 *  - Panels group lists and tables; plain sections use headings and space, not more boxes.
 *  - Money and dates use tabular figures (`num`); page titles and key figures use the display face.
 */
import { Link } from "react-router";
import { LogoFull } from "./brand";
import type { ComponentProps, ReactNode } from "react";
import type { ProjectStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ buttons
type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent border border-accent shadow-[var(--shadow-xs),inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-accent-hover hover:border-accent-hover active:translate-y-px",
  secondary: "bg-surface text-ink border border-line-strong shadow-[var(--shadow-xs)] hover:bg-sunken hover:border-line-hover active:translate-y-px",
  ghost: "text-ink-2 border border-transparent hover:bg-sunken hover:text-ink",
  danger: "bg-surface text-danger border border-line-strong shadow-[var(--shadow-xs)] hover:bg-danger-soft hover:border-danger/30 active:translate-y-px",
};
const base =
  "sf-btn inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,border-color,color,transform] duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none";
const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-3.5 text-sm" };

export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  return cx(base, variants[variant], sizes[size]);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />;
}

// ------------------------------------------------------------------ form fields
const control =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink shadow-[var(--shadow-xs)] placeholder:text-subtle transition-[border-color,box-shadow] duration-150 hover:border-line-hover focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/12 disabled:bg-sunken disabled:text-muted aria-invalid:border-danger aria-invalid:focus:ring-danger/12";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(control, "h-10", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(control, "py-2.5 leading-relaxed", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(control, "h-10 cursor-pointer pr-9", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] text-danger">
          <svg width="14" height="14" viewBox="0 0 16 16" className="mt-[3px] shrink-0" aria-hidden>
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M8 4.5v4M8 11v.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const alertIcon = {
  danger: <path d="M8 4.5v4M8 11v.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />,
  warning: <path d="M8 4.5v4M8 11v.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />,
  info: <path d="M8 7.5v4M8 5v.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />,
  positive: <path d="M5 8.3 7.1 10.4 11 6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
};
export function Alert({ tone = "danger", children }: { tone?: "danger" | "positive" | "info" | "warning"; children: ReactNode }) {
  const tones = {
    danger: "border-danger/20 bg-danger-soft text-danger-ink [--dot:var(--color-danger)]",
    positive: "border-positive/20 bg-positive-soft text-positive-ink [--dot:var(--color-positive)]",
    info: "border-accent-line bg-accent-soft text-info-ink [--dot:var(--color-accent)]",
    warning: "border-warning/25 bg-warning-soft text-warning-ink [--dot:#dc6803]",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed", tones[tone])}>
      <svg width="16" height="16" viewBox="0 0 16 16" className="mt-[3px] shrink-0" aria-hidden>
        <circle cx="8" cy="8" r="7.5" fill="var(--dot)" />
        {alertIcon[tone]}
      </svg>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ layout
/** A panel: groups a list, table or form. Not for every section — use SectionHeading and space for that. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]", className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold tracking-[-0.005em] text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] leading-snug text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A heading for a page section that isn't boxed. */
export function SectionHeading({ title, description, action, className }: { title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-3 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small facts under the title (status, client, dates). */
  meta?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-[13px] text-muted [&_a]:hover:text-ink">{eyebrow}</div> : null}
        <h1 className="display text-[28px] font-semibold leading-[1.1] text-balance text-ink sm:text-[32px]">{title}</h1>
        {meta ? <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">{meta}</div> : null}
        {description ? <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-sunken text-muted" aria-hidden>
        {icon ?? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M4 12h10M4 17h7" />
          </svg>
        )}
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Loading placeholder blocks. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

/** Segmented control for filters and views (tabs). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-sunken p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-[var(--shadow-xs)]" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className={cx("num text-[12px]", value === o.value ? "text-muted" : "text-subtle")}>{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ status
const statusTone: Record<ProjectStatus, BadgeTone> = {
  draft: "neutral",
  awaiting_approval: "warning",
  changes_requested: "danger",
  active: "accent",
  completed: "positive",
  cancelled: "neutral",
};

type BadgeTone = "neutral" | "accent" | "positive" | "warning" | "danger";
const badgeTones: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: "bg-sunken text-ink-2", dot: "bg-subtle" },
  accent: { box: "bg-accent-soft text-info-ink", dot: "bg-accent" },
  positive: { box: "bg-positive-soft text-positive", dot: "bg-[#17b26a]" },
  warning: { box: "bg-warning-soft text-warning", dot: "bg-[#f79009]" },
  danger: { box: "bg-danger-soft text-danger", dot: "bg-[#f04438]" },
};

/** A status: soft colour plus a dot, so it never relies on colour alone (the label says it). */
export function Badge({ tone = "neutral", dot = true, children, className }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string }) {
  const t = badgeTones[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-medium", t.box, className)}>
      {dot ? <span className={cx("size-1.5 rounded-full", t.dot)} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={statusTone[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function Tag({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <Badge tone={tone} dot={false}>
      {children}
    </Badge>
  );
}

/** The official ScopeFlow logo. Its height follows the font size (1.65em), so `text-[15px]` ≈ 25px tall. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center", className)}>
      <LogoFull className="h-[1.65em] w-auto" />
    </span>
  );
}

export function Meter({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warning" | "positive" }) {
  const pct = max <= 0 ? (value > 0 ? 100 : 0) : Math.min(100, (value / max) * 100);
  const tones = { accent: "bg-accent", warning: "bg-[#f79009]", positive: "bg-[#17b26a]" };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="presentation">
      <div className={cx("h-full rounded-full transition-[width] duration-500", tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ figures
const FIGURE_TONE = { accent: "bg-accent", warning: "bg-[#f79009]", positive: "bg-[#17b26a]", danger: "bg-[#f04438]", neutral: "bg-subtle" } as const;
export type FigureTone = keyof typeof FIGURE_TONE;

/** A row of key figures in one panel, separated by hairlines (2 per row on phones, up to 4 on wide screens). */
export function Figures({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <section
      aria-label={label}
      className={cx(
        "mb-6 grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)] lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none",
        "[&>*]:border-line max-lg:[&>*:nth-child(odd)]:border-r max-lg:[&>*:nth-child(n+3)]:border-t lg:[&>*:not(:last-child)]:border-r",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** One key figure: label with a small colour key, the value in the display face, and a note. Multiple values = one per line (e.g. per currency). */
export function Figure({ label, value, note, tone = "neutral", noteTone, testid }: { label: string; value: string | string[]; note?: ReactNode; tone?: FigureTone; noteTone?: "danger"; testid?: string }) {
  const lines = Array.isArray(value) ? (value.length ? value : ["—"]) : [value];
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <span className={cx("size-2 shrink-0 rounded-[3px]", FIGURE_TONE[tone])} aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      {lines.map((l, i) => (
        <p
          key={`${l}-${i}`}
          className={cx("display num mt-1.5 break-words font-semibold text-ink", lines.length > 1 ? "text-[19px] leading-snug" : "text-[26px] leading-none")}
          data-testid={i === 0 ? testid : undefined}
        >
          {l}
        </p>
      ))}
      {note ? <p className={cx("mt-2 text-[12px] leading-snug", noteTone === "danger" ? "font-medium text-danger" : "text-muted")}>{note}</p> : null}
    </div>
  );
}
