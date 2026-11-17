import { render } from "@testing-library/react";
import type { User } from "oidc-client-ts";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { AuthContext, type AuthValue } from "../auth/AuthContext";
import { MeProvider } from "../auth/useMe";

/**
 * Test helpers. `mockApi` replaces window.fetch with a function you control,
 * so tests can force any server answer — including failures — without a
 * server. Nothing here is used by the app itself.
 */

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

export function mockApi(handler: Handler) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init.method ?? "GET", ...(typeof init.body === "string" ? { body: init.body } : {}) });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const apiError = (status: number, code: string, message: string, requestId = "req-test-123") =>
  json({ error: { code, message, requestId } }, status);

export function release(id: number, title: string, releaseDate: string, datePrecision: "year" | "month" | "day", extra = {}) {
  return {
    id,
    googleVolumeId: `vol${id}`,
    title,
    authors: ["Ana Synthetic"],
    releaseDate,
    datePrecision,
    categories: ["Fiction"],
    thumbnailUrl: null,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

export function fakeAuth(signedIn: boolean): AuthValue {
  return {
    auth: signedIn ? { status: "signedIn", user: { profile: { sub: "test-user" } } as unknown as User } : { status: "signedOut" },
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => (signedIn ? "test-access-token" : null)),
  };
}

export function renderApp(ui: ReactElement, { signedIn = false, path = "/" } = {}) {
  window.history.replaceState({}, "", path);
  const auth = fakeAuth(signedIn);
  const result = render(
    <AuthContext.Provider value={auth}>
      <MeProvider>{ui}</MeProvider>
    </AuthContext.Provider>,
  );
  return { ...result, auth };
}
