import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, json, mockApi, release, renderApp } from "../test/helpers";
import { ReleasesPage } from "./ReleasesPage";

// F2: every remote call has visible loading, empty and error states.
// These tests FORCE each state by controlling what fetch returns.

const page = (items: unknown[], nextOffset: number | null = null) => ({ items, nextOffset, limit: 20, offset: 0 });

describe("ReleasesPage — loading, ready, empty, error (F2)", () => {
  it("shows a loading state, then the releases grouped by month with honest dates", async () => {
    let answer!: (r: Response) => void;
    mockApi(() => new Promise<Response>((r) => (answer = r)));
    renderApp(<ReleasesPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading releases…");

    answer(
      json(
        page([
          release(1, "Exact Day Book", "2026-11-04", "day"),
          release(2, "Sometime In November", "2026-11-01", "month"),
          release(3, "Next Year Book", "2027-01-01", "year"),
        ]),
      ),
    );

    expect(await screen.findByText("Exact Day Book")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sometime in 2027" })).toBeInTheDocument();
    expect(screen.getByText("4 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("2027")).toBeInTheDocument();
  });

  it("empty: a clear message, not a blank page", async () => {
    mockApi(() => json(page([])));
    renderApp(<ReleasesPage />);
    expect(await screen.findByText("No upcoming releases in the catalog yet.")).toBeInTheDocument();
  });

  it("FORCED FAILURE (network down): shows an error with Try again, and Try again recovers", async () => {
    let fail = true;
    const calls = mockApi(() => {
      if (fail) throw new TypeError("Failed to fetch");
      return json(page([release(1, "Recovered Book", "2026-12-01", "day")]));
    });
    renderApp(<ReleasesPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("Failed to fetch");

    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Recovered Book")).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });

  it("FORCED FAILURE (server 500): shows the API's message and the request id for support", async () => {
    mockApi(() => apiError(500, "internal", "Internal server error", "req-abc-999"));
    renderApp(<ReleasesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Internal server error");
    expect(alert).toHaveTextContent("req-abc-999");
  });

  it("FORCED FAILURE (unexpected response shape): treated as an error, not rendered half-broken", async () => {
    mockApi(() => json({ items: "not-a-list" }));
    renderApp(<ReleasesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

describe("ReleasesPage — search and filters (F1)", () => {
  it("asks the API for upcoming releases (from = today) when no filter is set", async () => {
    const calls = mockApi(() => json(page([])));
    renderApp(<ReleasesPage />);
    await screen.findByText(/No upcoming releases/);
    expect(new URL(calls[0]?.url ?? "", "http://x").searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("submitting the form puts the filters in the URL and the request", async () => {
    const calls = mockApi(() => json(page([])));
    renderApp(<ReleasesPage />);
    await screen.findByText(/No upcoming releases/);

    await userEvent.type(screen.getByLabelText("Title"), "dune");
    await userEvent.type(screen.getByLabelText("Author"), "Frank Herbert");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    const params = new URL(calls[1]?.url ?? "", "http://x").searchParams;
    expect(params.get("q")).toBe("dune");
    expect(params.get("author")).toBe("Frank Herbert");
    expect(window.location.search).toBe("?q=dune&author=Frank+Herbert");
    expect(await screen.findByText(/No releases match these filters/)).toBeInTheDocument();
  });

  it("filters in the URL are used on first load (shareable links)", async () => {
    const calls = mockApi(() => json(page([])));
    renderApp(<ReleasesPage />, { path: "/?category=Poetry" });
    await screen.findByText(/No releases match/);
    expect(new URL(calls[0]?.url ?? "", "http://x").searchParams.get("category")).toBe("Poetry");
    expect(screen.getByLabelText("Category")).toHaveValue("Poetry");
  });

  it("Later → requests the next page", async () => {
    const calls = mockApi((url) =>
      url.includes("offset=20")
        ? json({ ...page([release(21, "Page Two Book", "2027-01-01", "day")]), offset: 20 })
        : json(page([release(1, "Page One Book", "2026-12-01", "day")], 20)),
    );
    renderApp(<ReleasesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Later →" }));
    expect(await screen.findByText("Page Two Book")).toBeInTheDocument();
    expect(calls.at(-1)?.url).toContain("offset=20");
  });
});
