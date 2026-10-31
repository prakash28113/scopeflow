"use client";

import { useEffect, useState } from "react";
import { Alert } from "./ui";
import type { Flash as FlashT } from "@/lib/flash";

export function Flash({ flash }: { flash: FlashT | null }) {
  const [visible, setVisible] = useState(Boolean(flash));
  useEffect(() => {
    if (!flash) return;
    setVisible(true);
    document.cookie = "sf_flash=; Max-Age=0; path=/";
  }, [flash]);
  if (!flash || !visible) return null;
  return (
    <div className="mb-6">
      <Alert tone={flash.tone === "info" ? "info" : flash.tone}>
        <div className="flex items-start justify-between gap-4">
          <span>{flash.message}</span>
          <button type="button" onClick={() => setVisible(false)} className="text-[13px] opacity-70 hover:opacity-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      </Alert>
    </div>
  );
}
