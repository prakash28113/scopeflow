import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { RequireAuth } from "@/components/route-guards";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  loading: false,
  profile: { isLoading: false, isError: false, data: null as null | { onboarded_at: string | null }, refetch: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => state, useProfile: () => state.profile }));

function render(allowUnonboarded = false) {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/private"] },
    createElement(Routes, null,
      createElement(Route, { element: createElement(RequireAuth, { allowUnonboarded }) },
        createElement(Route, { path: "/private", element: createElement("p", null, "Protected content") })))));
}

beforeEach(() => {
  state.session = { user: { id: "test-user" } };
  state.loading = false;
  state.profile.isLoading = false;
  state.profile.isError = false;
  state.profile.data = { onboarded_at: "2026-01-01" };
});

describe("shared route guards after deferring the authenticated shell", () => {
  it("keeps protected content hidden while authentication or profile is loading", () => {
    state.loading = true;
    expect(render()).toContain('aria-label="Loading"');
    expect(render()).not.toContain("Protected content");
    state.loading = false;
    state.profile.isLoading = true;
    expect(render()).not.toContain("Protected content");
  });
  it("offers account recovery when the profile request fails or returns no profile", () => {
    state.profile.isError = true;
    expect(render()).toContain("Try again");
    expect(render()).not.toContain("Protected content");
    state.profile.isError = false;
    state.profile.data = null;
    expect(render()).toContain("Sign out");
    expect(render()).not.toContain("Protected content");
  });
  it("renders the nested route for an onboarded account", () => {
    expect(render()).toContain("Protected content");
  });
  it("continues to allow onboarding before a profile is onboarded", () => {
    state.profile.data = { onboarded_at: null };
    expect(render(true)).toContain("Protected content");
    expect(render()).not.toContain("Protected content");
  });
  it("never renders protected content without a session", () => {
    state.session = null;
    expect(render()).not.toContain("Protected content");
  });
});
