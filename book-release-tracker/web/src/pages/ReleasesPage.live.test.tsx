import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEventSource, installFakeEventSource, lastSource } from "../test/fakeEventSource";
import { json, mockApi, release, renderApp } from "../test/helpers";
import { ReleasesPage } from "./ReleasesPage";

// F11 on the page: the list updates itself when the server sends an event.

const page = (items: unknown[]) => ({ items, nextOffset: null, limit: 20, offset: 0 });
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("ReleasesPage — live updates", () => {
  beforeEach(() => {
    installFakeEventSource();
  });

  it("connects to /api/events and shows Live, then Reconnecting when the connection drops", async () => {
    mockApi(() => json(page([])));
    renderApp(<ReleasesPage />);
    expect(lastSource().url).toBe("/api/events");
    expect(screen.getByText("Connecting…")).toBeInTheDocument();

    act(() => lastSource().open());
    expect(screen.getByText("Live")).toBeInTheDocument();

    act(() => lastSource().drop());
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();

    act(() => lastSource().open()); // the browser reconnected by itself
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("a new release appears without a reload, tagged New, and without a loading flash", async () => {
    let items = [release(1, "Already There", "2027-01-01", "day")];
    const calls = mockApi(() => json(page(items)));
    renderApp(<ReleasesPage />);
    await screen.findByText("Already There");
    act(() => lastSource().open());
    await wait(300);
    const before = calls.length;

    items = [...items, release(2, "Freshly Imported", "2027-02-01", "day")];
    act(() => lastSource().emit("release.created", 5, { id: 2, title: "Freshly Imported", releaseDate: "2027-02-01" }));

    expect(screen.queryByText("Loading releases…")).not.toBeInTheDocument(); // old list stays visible
    // the list itself (not just the live log) now has the new book, tagged New
    const tag = await screen.findByText("New");
    expect(tag.closest(".title")).toHaveTextContent("Freshly ImportedNew");
    expect(screen.getByText("Already There")).toBeInTheDocument();
    expect(calls.length).toBe(before + 1);
    // screen readers are told what changed
    expect(screen.getByText("“Freshly Imported” was added.")).toBeInTheDocument();
  });

  it("a hidden release disappears", async () => {
    let items = [release(1, "Soon Gone", "2027-01-01", "day")];
    mockApi(() => json(page(items)));
    renderApp(<ReleasesPage />);
    await screen.findByText("Soon Gone");
    items = [];
    act(() => lastSource().emit("release.hidden", 7, { id: 1 }));
    expect(await screen.findByText(/No upcoming releases/)).toBeInTheDocument();
  });

  it("a burst of events causes one re-fetch, and a repeated event id is ignored", async () => {
    const calls = mockApi(() => json(page([])));
    renderApp(<ReleasesPage />);
    await screen.findByText(/No upcoming releases/);
    const before = calls.length;

    act(() => {
      const s = lastSource();
      s.emit("release.created", 10, { id: 1, title: "A" });
      s.emit("release.created", 11, { id: 2, title: "B" });
      s.emit("release.created", 11, { id: 2, title: "B" }); // duplicate id
      s.emit("release.created", 12, { id: 3, title: "C" });
    });
    await wait(400);
    expect(calls.length).toBe(before + 1);
    // D6: the re-fetch asks for the newest version, a key the CDN can't have cached yet
    expect(new URL(calls.at(-1)!.url, "http://x").searchParams.get("v")).toBe("12");

    await userEventOpenLog();
    const entries = screen.getAllByRole("listitem").filter((li) => li.closest(".live-log"));
    expect(entries.map((li) => li.textContent?.match(/#(\d+)/)?.[1])).toEqual(["12", "11", "10"]); // 11 once
  });

  it("a reset event (server couldn't replay) reloads the list", async () => {
    const calls = mockApi(() => json(page([])));
    renderApp(<ReleasesPage />);
    await screen.findByText(/No upcoming releases/);
    const before = calls.length;
    act(() => lastSource().emit("reset", 99, {}));
    await waitFor(() => expect(calls.length).toBe(before + 1));
  });

  it("the first connection triggers one re-fetch, covering changes made while the page was loading", async () => {
    const calls = mockApi(() => json(page([])));
    renderApp(<ReleasesPage />);
    await screen.findByText(/No upcoming releases/);
    const before = calls.length;
    act(() => lastSource().open());
    await waitFor(() => expect(calls.length).toBe(before + 1));
    // nothing changed yet, so the cached (unversioned) copy is fine
    expect(new URL(calls.at(-1)!.url, "http://x").searchParams.has("v")).toBe(false);
  });

  it("catalog reads never carry a token (they may be served from a shared cache)", async () => {
    const seen: RequestInit[] = [];
    mockApi((_url, init) => {
      seen.push(init);
      return json(page([]));
    });
    renderApp(<ReleasesPage />);
    await screen.findByText(/No upcoming releases/);
    act(() => lastSource().emit("release.created", 3, { id: 1, title: "A" }));
    await wait(300);
    expect(seen.length).toBeGreaterThan(1);
    for (const init of seen) expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
});

async function userEventOpenLog() {
  const summary = screen.getByText(/Live update log/);
  act(() => {
    (summary.closest("details") as HTMLDetailsElement).open = true;
  });
}

describe("ReleasesPage — silent dead stream (watchdog)", () => {
  it("no event or ping for 35 s: closes the stream and reconnects with the last event id", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      installFakeEventSource();
      mockApi(() => json(page([])));
      renderApp(<ReleasesPage />);
      const first = lastSource();
      act(() => first.open());
      act(() => first.emit("release.created", 42, { id: 1, title: "Seen" }));

      // pings keep it alive
      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(15_000);
          first.dispatchEvent(new MessageEvent("ping", { data: "{}" }));
        });
      }
      expect(FakeEventSource.instances).toHaveLength(1);

      // then silence (a proxy holding a dead stream open)
      act(() => {
        vi.advanceTimersByTime(35_001);
      });
      expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
      expect(first.readyState).toBe(FakeEventSource.CLOSED);
      expect(FakeEventSource.instances).toHaveLength(2);
      expect(lastSource().url).toBe("/api/events?lastEventId=42");

      act(() => lastSource().open());
      expect(screen.getByText("Live")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
