import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({ portalClient: { rpc: (...a: unknown[]) => rpc(...a) } }));
const { portalRpc } = await import("@/lib/portal-rpc");
const { userMessage } = await import("@/lib/errors");

describe("portalRpc", () => {
  it("passes data through", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await portalRpc("portal_view", {})).toEqual({ data: { ok: true }, error: null });
  });
  it("turns structured link/rate errors into user-facing errors", async () => {
    for (const [kind, code] of [["invalid_link", "28000"], ["expired_link", "28000"], ["rate_limited", "55000"]] as const) {
      rpc.mockResolvedValueOnce({ data: { error: kind, message: `msg ${kind}` }, error: null });
      const r = await portalRpc("portal_view", {});
      expect(r.data).toBeNull();
      expect(r.error).toEqual({ code, message: `msg ${kind}`, kind });
      expect(userMessage(r.error)).toBe(`msg ${kind}`);
    }
  });
  it("keeps transport errors without a kind", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST301", message: "JWT expired" } });
    const r = await portalRpc("portal_view", {});
    expect(r.error?.kind).toBeUndefined();
  });
});
