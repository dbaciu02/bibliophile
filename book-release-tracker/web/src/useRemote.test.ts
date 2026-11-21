import { describe, expect, it } from "vitest";
import { withVersion } from "./useRemote";

// D6: the cache-version key added to public catalog reads after a live change.
describe("withVersion", () => {
  it("adds v to an existing query, keeping the other parameters", () => {
    expect(withVersion("/api/releases?from=2026-11-20&limit=20", "42")).toBe("/api/releases?from=2026-11-20&limit=20&v=42");
  });
  it("replaces an older v instead of adding a second one", () => {
    expect(withVersion("/api/releases?v=7&limit=20", "8")).toBe("/api/releases?v=8&limit=20");
  });
  it("works without a query, and leaves the URL alone with no version", () => {
    expect(withVersion("/api/releases/5", "3")).toBe("/api/releases/5?v=3");
    expect(withVersion("/api/releases?limit=20", undefined)).toBe("/api/releases?limit=20");
  });
});
