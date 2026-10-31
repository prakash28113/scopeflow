import { useState, type ComponentProps } from "react";
import { Button } from "./ui";

export function SubmitButton({
  pending,
  pendingLabel = "Saving…",
  children,
  ...props
}: ComponentProps<typeof Button> & { pending?: boolean; pendingLabel?: string }) {
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Button that runs an async action, optionally after a confirmation prompt. */
export function ActionButton({
  onAction,
  confirm,
  pendingLabel = "…",
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & {
  onAction: () => Promise<unknown>;
  confirm?: string;
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      disabled={pending || props.disabled}
      aria-busy={pending}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setPending(true);
        try {
          await onAction();
        } finally {
          setPending(false);
        }
      }}
      {...props}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", variant = "secondary" as const, size = "sm" as const }: {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.prompt("Copy this:", value);
        }
      }}
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}
