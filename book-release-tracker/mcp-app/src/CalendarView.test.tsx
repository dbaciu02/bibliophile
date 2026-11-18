import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarView, type FollowCall } from "./CalendarView";
import { parseResult, Calendar, type ToolResultLike } from "./result";

const release = (id: number, title: string, releaseDate: string, datePrecision: "day" | "month" | "year", authors = ["Mira Solano"]) => ({
  id,
  title,
  authors,
  releaseDate,
  datePrecision,
  categories: ["Fantasy"],
  thumbnailUrl: null,
});

const calendar: Calendar = {
  status: "ok",
  from: "2026-11-17",
  to: "2027-02-17",
  filters: { author: null, category: null },
  releases: [
    release(1, "The Lantern Keeper", "2026-11-23", "day"),
    release(2, "Iron Bloom", "2027-01-01", "month", ["Mira Solano", "Theo Varga"]),
    release(3, "Someday Book", "2027-01-01", "year", ["Theo Varga"]),
  ],
};

const confirmation = (author: string): ToolResultLike => ({
  content: [{ type: "text", text: "…" }],
  structuredContent: {
    status: "confirmation_required",
    question: `Add “${author}” to your Bibliophile watchlist?`,
    confirmationToken: "tok-123",
    expiresAt: "2026-11-17T20:00:00Z",
  },
});
const added = (author: string): ToolResultLike => ({
  content: [{ type: "text", text: "added" }],
  structuredContent: { status: "added", item: { id: 1, author, upcomingCount: 2, createdAt: "x" } },
});

function setup(follow: FollowCall) {
  const onMonthsChange = vi.fn();
  render(<CalendarView calendar={calendar} months={3} onMonthsChange={onMonthsChange} loading={false} follow={follow} />);
  return { user: userEvent.setup(), onMonthsChange };
}

describe("CalendarView", () => {
  it("groups by month, with a year-only group after that year's months", () => {
    setup(vi.fn());
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "November 2026",
      "January 2027",
      "Sometime in 2027",
    ]);
    expect(screen.getByText("23 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("Jan 2027")).toBeInTheDocument();
  });

  it("Follow asks first, writes only after Confirm, using the server's token", async () => {
    const follow = vi.fn<FollowCall>().mockResolvedValueOnce(confirmation("Theo Varga")).mockResolvedValueOnce(added("Theo Varga"));
    const { user } = setup(follow);

    await user.click(screen.getAllByRole("button", { name: "Follow Theo Varga" })[0]!);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenLastCalledWith("Theo Varga");

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Add “Theo Varga” to your Bibliophile watchlist?");
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(follow).toHaveBeenCalledTimes(2);
    expect(follow).toHaveBeenLastCalledWith("Theo Varga", "tok-123");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Every place Theo appears now says Following; Mira is unaffected.
    expect(screen.queryByRole("button", { name: "Follow Theo Varga" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Following")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Follow Mira Solano" })).toHaveLength(2);
    expect(screen.getByText(/Now following Theo Varga/)).toBeInTheDocument();
  });

  it("Cancel (or Escape) sends nothing more", async () => {
    const follow = vi.fn<FollowCall>().mockResolvedValue(confirmation("Mira Solano"));
    const { user } = setup(follow);
    await user.click(screen.getAllByRole("button", { name: "Follow Mira Solano" })[0]!);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Follow Mira Solano" })[0]!);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Follow Mira Solano" })[0]).toHaveFocus();
    expect(follow).toHaveBeenCalledTimes(2);
    expect(follow.mock.calls.every((c) => c.length === 1)).toBe(true); // never with a token
  });

  it("shows the server's error message (e.g. already following)", async () => {
    const follow = vi.fn<FollowCall>().mockResolvedValue({ isError: true, content: [{ type: "text", text: "You are already watching Mira Solano." }] });
    const { user } = setup(follow);
    await user.click(screen.getAllByRole("button", { name: "Follow Mira Solano" })[0]!);
    expect(screen.getAllByText(/already watching Mira Solano/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("a network failure becomes an error message, not a crash", async () => {
    const follow = vi.fn<FollowCall>().mockRejectedValue(new Error("host went away"));
    const { user } = setup(follow);
    await user.click(screen.getAllByRole("button", { name: "Follow Mira Solano" })[0]!);
    expect(screen.getAllByText(/host went away/).length).toBeGreaterThan(0);
  });

  it("a scope refusal (403 insufficient_scope) explains which permission is missing", async () => {
    const follow = vi.fn<FollowCall>().mockRejectedValue(new Error('Insufficient scope: required "api://x/Watchlist.ReadWrite"'));
    const { user } = setup(follow);
    await user.click(screen.getAllByRole("button", { name: "Follow Mira Solano" })[0]!);
    expect(screen.getAllByText(/permission to change your watchlist/).length).toBeGreaterThan(0);
  });

  it("changing the range asks for a new calendar", async () => {
    const { user, onMonthsChange } = setup(vi.fn());
    await user.selectOptions(screen.getByRole("combobox", { name: /show next/i }), "12");
    expect(onMonthsChange).toHaveBeenCalledWith(12);
  });

  it("empty range -> a helpful empty state", () => {
    render(<CalendarView calendar={{ ...calendar, releases: [] }} months={1} onMonthsChange={vi.fn()} loading={false} follow={vi.fn()} />);
    expect(screen.getByText(/No releases between 2026-11-17 and 2027-02-17/)).toBeInTheDocument();
  });
});

describe("parseResult", () => {
  it("passes the tool's own error text through", () => {
    expect(parseResult(Calendar, { isError: true, content: [{ type: "text", text: "Nope." }] })).toEqual({ ok: false, message: "Nope." });
  });
  it("rejects a reply with the wrong shape", () => {
    const r = parseResult(Calendar, { structuredContent: { status: "ok", releases: "lots" } });
    expect(r.ok).toBe(false);
  });
  it("accepts a real calendar reply", () => {
    expect(parseResult(Calendar, { structuredContent: calendar }).ok).toBe(true);
  });
});
