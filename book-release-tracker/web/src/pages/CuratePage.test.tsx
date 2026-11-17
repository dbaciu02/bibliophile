import { screen } from "@testing-library/react";
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
const search = (items: unknown[], source = "live") => ({ items, totalItems: items.length, source, fetchedAt: "2026-11-16T23:31:05.666Z" });

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
