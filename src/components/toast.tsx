import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx } from "./ui";

type Tone = "positive" | "danger" | "info";
type Toast = { id: number; tone: Tone; message: string };
const ToastContext = createContext<(tone: Tone, message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "danger" ? 8000 : 4500);
  }, []);
  const tones: Record<Tone, string> = {
    positive: "border-positive/25 bg-positive-soft text-positive",
    danger: "border-danger/25 bg-danger-soft text-danger",
    info: "border-accent-line bg-accent-soft text-accent-hover",
  };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "danger" ? "alert" : "status"}
            className={cx("pointer-events-auto w-full max-w-md rounded-lg border px-4 py-3 text-sm shadow-[0_8px_24px_-12px_rgba(22,24,29,0.25)]", tones[t.tone])}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
