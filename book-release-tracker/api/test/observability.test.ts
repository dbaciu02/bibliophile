/** D10: metric labels stay low-cardinality whatever URL is requested. */
import { describe, expect, it } from "vitest";
import { routeLabel } from "../src/observability.js";

describe("routeLabel", () => {
  it.each([
    ["/api/releases", "/api/releases"],
    ["/api/releases/", "/api/releases"],
    ["/api/releases/42", "/api/releases/:id"],
    ["/api/releases/import", "/api/releases/import"],
    ["/api/books/search", "/api/books/search"],
    ["/api/me/watchlist/7", "/api/me/watchlist/:id"],
    ["/api/events", "/api/events"],
    ["/mcp", "/mcp"],
    ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource/mcp"],
  ])("%s -> %s", (path, label) => {
    expect(routeLabel(path)).toBe(label);
  });

  it("anything that isn't a real route is 'other' (scanners can't create new series)", () => {
    for (const p of ["/", "/wp-admin", "/api/nope/123", "/api/releases/abc", "/api/releases/1/2", "/.env", "/api/books/xyz"]) {
      expect(routeLabel(p), p).toBe("other");
    }
  });
});
