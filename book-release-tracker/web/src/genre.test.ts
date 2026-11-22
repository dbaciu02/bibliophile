import { describe, expect, it } from "vitest";
import { genreClass, genreSlug } from "./genre";

describe("genre colours", () => {
  it.each([
    ["Fantasy", "fantasy"],
    ["Science Fiction", "science-fiction"],
    ["Young Adult", "young-adult"],
    ["Fiction / Fantasy / Epic", "fantasy"],
    ["Juvenile Fiction", "default"],
    ["", "default"],
    [undefined, "default"],
  ])("%s -> %s", (category, slug) => {
    expect(genreSlug(category)).toBe(slug);
  });

  it("uses the first category", () => {
    expect(genreClass(["Romance", "Historical Fiction"])).toBe("genre-romance");
    expect(genreClass([])).toBe("genre-default");
  });
});
