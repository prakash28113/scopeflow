import { describe, expect, it, vi } from "vitest";
import { createStaticHandler } from "react-router";
import { routes } from "@/routes/tree";

const shell = vi.hoisted(() => ({ loaded: false }));
vi.mock("@/components/app-shell", () => {
  shell.loaded = true;
  return { AppShell: () => null };
});

describe("public routes defer authenticated navigation", () => {
  it("resolves public pages and the anonymous portal without loading the shell", async () => {
    const handler = createStaticHandler(routes);
    for (const path of ["/", "/pricing", "/p"]) {
      const context = await handler.query(new Request(`https://scopeflow.test${path}`));
      expect(context).not.toBeInstanceOf(Response);
      expect("statusCode" in context && context.statusCode).toBe(200);
      expect(shell.loaded).toBe(false);
    }
    const context = await handler.query(new Request("https://scopeflow.test/dashboard"));
    expect(context).not.toBeInstanceOf(Response);
    expect(shell.loaded).toBe(true);
  });
});
