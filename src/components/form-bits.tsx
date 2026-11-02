import { useEffect, useRef, useState, type ComponentProps } from "react";
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

/** Button that runs an async action, optionally after an in-app confirmation (for anything destructive). */
export function ActionButton({
  onAction,
  confirm,
  confirmLabel,
  pendingLabel = "…",
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & {
  onAction: () => Promise<unknown>;
  /** Asks first, in a dialog, with this message. */
  confirm?: string;
  /** The confirm button's label (defaults to the button's own text). */
  confirmLabel?: string;
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      await onAction();
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Button
        type="button"
        disabled={pending || props.disabled}
        aria-busy={pending}
        onClick={() => (confirm ? setAsking(true) : void run())}
        {...props}
      >
        {pending ? pendingLabel : children}
      </Button>
      {confirm ? (
        <ConfirmDialog
          open={asking}
          message={confirm}
          confirmLabel={confirmLabel ?? (typeof children === "string" ? children : "Confirm")}
          danger={props.variant === "danger" || /delete|remove|void|cancel|revoke|withdraw/i.test(String(confirmLabel ?? children))}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void run();
          }}
        />
      ) : null}
    </>
  );
}

/** The app's confirmation dialog: one question, a clear consequence, Cancel or the named action. */
export function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby="confirm-title"
      className="sf-dialog m-auto w-[calc(100%-32px)] max-w-md rounded-[14px] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]"
      onClose={onCancel}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="p-5">
        <h2 id="confirm-title" className="text-[16px] font-semibold">
          {title}
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{message}</p>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line bg-canvas/60 px-5 py-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} autoFocus>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          className={danger ? "border-danger bg-danger hover:border-[#912018] hover:bg-[#912018]" : undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
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
