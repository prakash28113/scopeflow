import { Link } from "react-router";
import type { ComponentProps, ReactNode } from "react";
import type { ProjectStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ buttons
type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover border border-accent hover:border-accent-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-sunken",
  ghost: "text-ink-2 hover:bg-sunken border border-transparent",
  danger: "bg-surface text-danger border border-line-strong hover:bg-danger-soft hover:border-danger/30",
};
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm" };

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
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-subtle transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(control, "h-10", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(control, "py-2.5 leading-relaxed", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(control, "h-10 pr-8", className)} {...props} />;
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
        <p className="text-[13px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "positive" | "info" | "warning"; children: ReactNode }) {
  const tones = {
    danger: "border-danger/20 bg-danger-soft text-danger",
    positive: "border-positive/20 bg-positive-soft text-positive",
    info: "border-accent-line bg-accent-soft text-accent-hover",
    warning: "border-warning/20 bg-warning-soft text-warning",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg border px-3.5 py-2.5 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ layout
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-[var(--radius-card)] border border-line bg-surface", className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
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
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-[13px] text-muted">{eyebrow}</div> : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-balance">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ status
const statusTone: Record<ProjectStatus, string> = {
  draft: "bg-subtle",
  awaiting_approval: "bg-warning",
  changes_requested: "bg-danger",
  active: "bg-accent",
  completed: "bg-positive",
  cancelled: "bg-line-strong",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12px] font-medium text-ink-2">
      <span className={cx("size-1.5 rounded-full", statusTone[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Tag({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "positive" | "warning" | "danger"; children: ReactNode }) {
  const tones = {
    neutral: "bg-sunken text-ink-2",
    accent: "bg-accent-soft text-accent-hover",
    positive: "bg-positive-soft text-positive",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium", tones[tone])}>{children}</span>;
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-[-0.02em]", className)}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <path d="M2 7V2h5M15 2h5v5M20 15v5h-5M7 20H2v-5" fill="none" stroke="#3F6FD1" strokeWidth="2" strokeLinecap="round" />
        <rect x="7" y="7" width="8" height="8" rx="1.5" fill="#16181D" />
      </svg>
      ScopeFlow
    </span>
  );
}

export function Meter({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warning" | "positive" }) {
  const pct = max <= 0 ? (value > 0 ? 100 : 0) : Math.min(100, (value / max) * 100);
  const tones = { accent: "bg-accent", warning: "bg-warning", positive: "bg-positive" };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="presentation">
      <div className={cx("h-full rounded-full", tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
