import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, json, mockApi, renderApp } from "../test/helpers";
import { CuratePage } from "./CuratePage";

const curator = { subject: "c", name: "Test Curator", roles: ["Curator"], scopes: [] };
const reader = { subject: "r", name: "Test Reader", roles: ["Reader"], scopes: [] };

const candidate = (id: string, extra = {}) => ({
  googleVolumeId: id,
  title: `Book ${id}`,
  authors: ["Ana Synthetic"],
  publishedDateRaw: "2027-03",
  releaseDate: "2027-03-01",
  datePrecision: "month",
  categories: [],
  thumbnailUrl: null,
  inCatalog: false,
  ...extra,
});
const search = (items: unknown[], source = "live", hiddenByDateFilter = 0) => ({
  items,
  totalItems: items.length + hiddenByDateFilter,
  hiddenByDateFilter,
  googleQuery: "dune",
  source,
  fetchedAt: "2026-11-16T23:31:05.666Z",
});

describe("CuratePage", () => {
  it("a Reader is told the page is for curators (the API would 403 anyway)", async () => {
    mockApi(() => json(reader));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate" });
    expect(await screen.findByText(/doesn’t have the Curator role/)).toBeInTheDocument();
  });

  it("search -> results -> import: button turns into 'In the catalog'", async () => {
    const calls = mockApi((url, init) => {
      if (url === "/api/me") return json(curator);
      if (init.method === "POST") return json({ id: 1 }, 201);
      return json(search([candidate("v1"), candidate("v2", { releaseDate: null, datePrecision: null, publishedDateRaw: null })]));
    });
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?q=dune" });

    expect(await screen.findByText("Book v1")).toBeInTheDocument();
    expect(screen.getByText(/Can’t import automatically/)).toBeInTheDocument(); // v2 has no date

    await userEvent.click(screen.getByRole("button", { name: "Import Book v1" }));
    expect(await screen.findByText("In the catalog ✓")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toBe(JSON.stringify({ googleVolumeId: "v1" }));
  });

  it("Google down but cached: shows the results with a 'may be out of date' banner (F10 degraded mode)", async () => {
    mockApi((url) => (url === "/api/me" ? json(curator) : json(search([candidate("v1")], "stale"))));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?q=dune" });
    expect(await screen.findByText(/isn’t responding, so these are saved results/)).toBeInTheDocument();
    expect(screen.getByText("Book v1")).toBeInTheDocument();
  });

  it("FORCED FAILURE: Google down and nothing cached -> the API's 503 message", async () => {
    mockApi((url) =>
      url === "/api/me" ? json(curator) : apiError(503, "upstream_unavailable", "Google Books is unavailable right now"),
    );
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?q=dune" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Google Books is unavailable right now");
  });

  it("FORCED FAILURE: import rejected (e.g. 429) -> message next to that book, page keeps working", async () => {
    mockApi((url, init) => {
      if (url === "/api/me") return json(curator);
      if (init.method === "POST") return apiError(429, "rate_limited", "Too many requests; try again in 30 s");
      return json(search([candidate("v1")]));
    });
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?q=dune" });
    await userEvent.click(await screen.findByRole("button", { name: "Import Book v1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.getByRole("button", { name: "Import Book v1" })).toBeEnabled();
  });
});

describe("CuratePage — search form fields", () => {
  it("the filled-in fields go into the URL and the API request; empty ones are left out", async () => {
    const calls = mockApi((url) => (url === "/api/me" ? json(curator) : json(search([candidate("v1")]))));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate" });

    await userEvent.type(await screen.findByLabelText("Author"), "Frank Herbert");
    await userEvent.type(screen.getByLabelText("Subject / category"), "Fiction");
    await userEvent.selectOptions(screen.getByLabelText("Year"), String(new Date().getFullYear() + 1));
    await userEvent.click(screen.getByLabelText("Upcoming only"));
    await userEvent.selectOptions(screen.getByLabelText("Sort"), "newest");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/books/search"))).toBe(true));
    const sent = new URL(calls.find((c) => c.url.startsWith("/api/books/search"))?.url ?? "", "http://x").searchParams;
    expect(Object.fromEntries(sent)).toEqual({
      author: "Frank Herbert",
      subject: "Fiction",
      year: String(new Date().getFullYear() + 1),
      upcomingOnly: "true",
      orderBy: "newest",
      maxResults: "20",
    });
    expect(window.location.pathname + window.location.search).toBe(
      `/curate?author=Frank+Herbert&subject=Fiction&year=${new Date().getFullYear() + 1}&upcomingOnly=true&orderBy=newest`,
    );
  });

  it("a year alone isn't a search: explains why and calls nothing", async () => {
    const calls = mockApi(() => json(curator));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate" });
    await userEvent.selectOptions(await screen.findByLabelText("Year"), String(new Date().getFullYear()));
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Google can’t search by year alone");
    expect(calls.filter((c) => c.url.startsWith("/api/books/search"))).toHaveLength(0);
  });

  it("a shared link fills the form back in", async () => {
    mockApi((url) => (url === "/api/me" ? json(curator) : json(search([]))));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?title=dune&isbn=9780441013593&upcomingOnly=true" });
    expect(await screen.findByLabelText("Title")).toHaveValue("dune");
    expect(screen.getByLabelText("ISBN")).toHaveValue("9780441013593"); // "More fields" opens itself
    expect(screen.getByLabelText("Upcoming only")).toBeChecked();
  });

  it("says how many results the date filter hid", async () => {
    mockApi((url) => (url === "/api/me" ? json(curator) : json(search([candidate("v1")], "live", 7))));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?q=dune&year=2027" });
    expect(await screen.findByText(/7 hidden by the date filter/)).toBeInTheDocument();
  });

  it("everything hidden by the date filter: the empty message says so", async () => {
    mockApi((url) => (url === "/api/me" ? json(curator) : json(search([], "live", 12))));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?q=dune&upcomingOnly=true" });
    expect(await screen.findByText(/none matched the year \/ upcoming filter/)).toBeInTheDocument();
  });

  it("Clear empties the form and the URL", async () => {
    mockApi((url) => (url === "/api/me" ? json(curator) : json(search([]))));
    renderApp(<CuratePage />, { signedIn: true, path: "/curate?author=Ana" });
    await userEvent.click(await screen.findByRole("button", { name: "Clear" }));
    expect(window.location.search).toBe("");
    expect(screen.getByLabelText("Author")).toHaveValue("");
  });
});
