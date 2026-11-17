import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, json, mockApi, renderApp } from "../test/helpers";
import { WatchlistPage } from "./WatchlistPage";

const me = { subject: "test-user", name: "Test Reader", roles: ["Reader"], scopes: [] };
const item = (id: number, author: string, upcomingCount = 0) => ({ id, author, upcomingCount, createdAt: "2026-11-01T00:00:00Z" });

describe("WatchlistPage", () => {
  it("signed out: explains and offers sign-in, makes no API call", async () => {
    const calls = mockApi(() => json({}));
    const { auth } = renderApp(<WatchlistPage />, { signedIn: false });
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    expect(auth.signIn).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("sends the access token and shows the list", async () => {
    mockApi((url) => (url === "/api/me" ? json(me) : json({ items: [item(1, "Ana Synthetic", 2)] })));
    renderApp(<WatchlistPage />, { signedIn: true });
    expect(await screen.findByText("Ana Synthetic")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2 upcoming releases" })).toHaveAttribute("href", "/?author=Ana%20Synthetic");
  });

  it("empty list: a helpful message", async () => {
    mockApi((url) => (url === "/api/me" ? json(me) : json({ items: [] })));
    renderApp(<WatchlistPage />, { signedIn: true });
    expect(await screen.findByText(/aren’t following any authors yet/)).toBeInTheDocument();
  });

  it("adding an author already followed shows the API's 409 message", async () => {
    const calls = mockApi((url, init) => {
      if (url === "/api/me") return json(me);
      if (init.method === "POST") return apiError(409, "conflict", "You are already watching Ana Synthetic");
      return json({ items: [item(1, "Ana Synthetic")] });
    });
    renderApp(<WatchlistPage />, { signedIn: true });
    await screen.findByText("Ana Synthetic");

    await userEvent.type(screen.getByLabelText("Follow an author"), "Ana Synthetic");
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You are already watching Ana Synthetic");
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toBe(JSON.stringify({ authorName: "Ana Synthetic" }));
  });

  it("removing an author calls DELETE and reloads the list", async () => {
    let removed = false;
    const calls = mockApi((url, init) => {
      if (url === "/api/me") return json(me);
      if (init.method === "DELETE") {
        removed = true;
        return new Response(null, { status: 204 });
      }
      return json({ items: removed ? [] : [item(7, "Bo Fictional")] });
    });
    renderApp(<WatchlistPage />, { signedIn: true });
    await userEvent.click(await screen.findByRole("button", { name: "Remove Bo Fictional" }));
    expect(await screen.findByText(/aren’t following any authors yet/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/me/watchlist/7")).toBe(true));
  });

  it("FORCED FAILURE: list request fails -> error state with Try again", async () => {
    mockApi((url) => (url === "/api/me" ? json(me) : apiError(503, "upstream_unavailable", "Service unavailable")));
    renderApp(<WatchlistPage />, { signedIn: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
