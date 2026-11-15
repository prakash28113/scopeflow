import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { z } from "zod";

// Exercise the event handlers before a rerender, when disabled DOM state cannot help.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: vi.fn(),
}));
vi.mock("@/lib/plans", () => ({ planLimitFrom: () => null }));

import { useAction } from "@/lib/use-action";
import { ActionButton, SubmitButton } from "@/components/form-bits";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("form submission safety", () => {
  it("keeps a pending submit disabled even when CAPTCHA's disabled prop is false", () => {
    const html = renderToStaticMarkup(SubmitButton({ pending: true, disabled: false, children: "Save" }));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(SubmitButton({ pending: false, disabled: false, children: "Save" }))).not.toContain('disabled=""');
    expect(renderToStaticMarkup(SubmitButton({ pending: false, disabled: true, children: "Save" }))).toContain('disabled=""');
  });

  it("sends one form RPC for simultaneous submissions and allows the next submission", async () => {
    const action = useAction();
    const response = deferred<{ data: string; error: null }>();
    const rpc = vi.fn(() => response.promise);
    const first = action.run(z.string(), "project", rpc);
    expect(await action.run(z.string(), "project", rpc)).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    response.resolve({ data: "created", error: null });
    expect(await first).toBe("created");
    expect(await action.run(z.string(), "project", rpc)).toBe("created");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("unlocks after database errors and invalid forms do not hold the lock", async () => {
    const action = useAction();
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "failure" } }).mockResolvedValue({ data: "saved", error: null });
    expect(await action.run(z.string().min(1), "", rpc)).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(await action.run(z.string(), "ok", rpc)).toBeUndefined();
    expect(await action.run(z.string(), "ok", rpc)).toBe("saved");
  });

  it("prevents rapid duplicate action clicks before pending state renders", async () => {
    const response = deferred<void>();
    const onAction = vi.fn(() => response.promise);
    const element = ActionButton({ onAction, disabled: false, children: "Mark paid" });
    const button = (element.props as { children: ReactElement<{ onClick: () => void }>[] }).children[0];
    button.props.onClick();
    button.props.onClick();
    expect(onAction).toHaveBeenCalledTimes(1);
    response.resolve();
    await response.promise;
    await Promise.resolve();
    button.props.onClick();
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("allows retry after a network exception", async () => {
    const action = useAction();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rpc = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: "saved", error: null });
      expect(await action.run(z.string(), "ok", rpc)).toBeUndefined();
      expect(await action.run(z.string(), "ok", rpc)).toBe("saved");
    } finally {
      log.mockRestore();
    }
  });
});
