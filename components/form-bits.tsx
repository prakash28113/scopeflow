"use client";

import { useFormStatus } from "react-dom";
import { useState, type ComponentProps } from "react";
import { Button } from "./ui";

export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </Button>
  );
}

export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.prompt("Copy this link:", value);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A form button that asks for confirmation before submitting. */
export function ConfirmSubmit({
  message,
  ...props
}: ComponentProps<typeof SubmitButton> & { message: string }) {
  return (
    <SubmitButton
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    />
  );
}
