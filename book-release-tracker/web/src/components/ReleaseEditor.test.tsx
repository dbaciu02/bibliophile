import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { installFakeEventSource } from "../test/fakeEventSource";
import { apiError, json, mockApi, release, renderApp } from "../test/helpers";
import { ReleasesPage } from "../pages/ReleasesPage";
import { AddReleaseForm, CuratorActions, checkValues, fromRelease, toBody } from "./ReleaseEditor";

// Curator tools for releases typed in by hand: add (Curate page), edit and hide (release rows).

const curator = { subject: "c", name: "Test Curator", roles: ["Curator"], scopes: [] };
const reader = { subject: "r", name: "Test Reader", roles: ["Reader"], scopes: [] };
const page = (items: unknown[]) => ({ items, nextOffset: null, limit: 20, offset: 0 });

describe("form helpers", () => {
  it("toBody splits comma lists, trims, and sends an empty cover as null", () => {
    expect(
      toBody({ title: " A Book ", authors: "Ana Synthetic, Bo Fictional,", publishedDate: "2027-03", categories: "", thumbnailUrl: " " }),
    ).toEqual({ title: "A Book", authors: ["Ana Synthetic", "Bo Fictional"], publishedDate: "2027-03", categories: [], thumbnailUrl: null });
  });

  it("fromRelease shows the date only as precisely as it is known", () => {
    expect(fromRelease(release(1, "T", "2027-03-01", "month")).publishedDate).toBe("2027-03");
    expect(fromRelease(release(1, "T", "2027-01-01", "year")).publishedDate).toBe("2027");
    expect(fromRelease(release(1, "T", "2027-03-15", "day")).publishedDate).toBe("2027-03-15");
  });

  it("checkValues catches the obvious mistakes before sending", () => {
    expect(Object.keys(checkValues({ title: "", authors: " , ", publishedDate: "March", categories: "", thumbnailUrl: "http://x" })).sort()).toEqual(
      ["authors", "publishedDate", "thumbnailUrl", "title"],
    );
    expect(checkValues({ title: "T", authors: "A", publishedDate: "2027", categories: "", thumbnailUrl: "" })).toEqual({});
  });
});

async function openAddForm() {
  await userEvent.click(screen.getByRole("button", { name: /Add a release by hand/ }));
}

describe("AddReleaseForm", () => {
  it("adds a release without a Google id, then clears the form and says so", async () => {
    const calls = mockApi(() => json({ ...release(9, "Typed In", "2027-05-01", "month"), googleVolumeId: "manual-abc" }, 201));
    renderApp(<AddReleaseForm />, { signedIn: true });
    await openAddForm();
    await userEvent.type(screen.getByLabelText("Title"), "Typed In");
    await userEvent.type(screen.getByLabelText("Authors"), "Ana Synthetic, Bo Fictional");
    await userEvent.type(screen.getByLabelText("Release date"), "2027-05");
    await userEvent.type(screen.getByLabelText("Categories"), "Fiction");
    await userEvent.click(screen.getByRole("button", { name: "Add release" }));

    expect(await screen.findByText("Added “Typed In”. It’s on the releases page now.")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/releases");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      title: "Typed In",
      authors: ["Ana Synthetic", "Bo Fictional"],
      publishedDate: "2027-05",
      categories: ["Fiction"],
      thumbnailUrl: null,
    });
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("obvious mistakes are flagged on the fields and nothing is sent", async () => {
    const calls = mockApi(() => json({}, 201));
    renderApp(<AddReleaseForm />, { signedIn: true });
    await openAddForm();
    await userEvent.type(screen.getByLabelText("Release date"), "next spring");
    await userEvent.click(screen.getByRole("button", { name: "Add release" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Release date")).toHaveAccessibleDescription(/2027-03-15 Not a date in one of the formats above/);
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("the server's per-field messages are shown next to the field (it validates again)", async () => {
    mockApi(() =>
      json(
        {
          error: {
            code: "validation_failed",
            message: "Invalid request",
            requestId: "req-1",
            details: [{ path: "publishedDate", message: 'Must be "YYYY", "YYYY-MM" or a real "YYYY-MM-DD" date' }],
          },
        },
        400,
      ),
    );
    renderApp(<AddReleaseForm />, { signedIn: true });
    await openAddForm();
    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.type(screen.getByLabelText("Authors"), "A");
    await userEvent.type(screen.getByLabelText("Release date"), "2027-02-30");
    await userEvent.click(screen.getByRole("button", { name: "Add release" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid request (reference req-1)");
    expect(screen.getByLabelText("Release date")).toHaveAccessibleDescription(/a real "YYYY-MM-DD" date/);
  });

  it("a 403 (not a curator any more) is shown, not swallowed", async () => {
    mockApi(() => apiError(403, "forbidden", "Requires role Curator"));
    renderApp(<AddReleaseForm />, { signedIn: true });
    await openAddForm();
    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.type(screen.getByLabelText("Authors"), "A");
    await userEvent.type(screen.getByLabelText("Release date"), "2027");
    await userEvent.click(screen.getByRole("button", { name: "Add release" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Requires role Curator");
  });
});

describe("CuratorActions", () => {
  it("Edit opens a prefilled form; Save sends a PATCH and reports the change", async () => {
    const calls = mockApi(() => json(release(5, "Renamed", "2027-03-01", "month")));
    const onChanged = vi.fn();
    renderApp(<CuratorActions release={release(5, "Old Title", "2027-03-01", "month")} onChanged={onChanged} />, { signedIn: true });
    await userEvent.click(screen.getByRole("button", { name: "Edit Old Title" }));
    expect(screen.getByLabelText("Release date")).toHaveValue("2027-03");
    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("/api/releases/5");
    expect(JSON.parse(patch?.body ?? "{}")).toMatchObject({ title: "Renamed", publishedDate: "2027-03" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument(); // back to the row
  });

  it("Hide asks first; Cancel sends nothing; confirming sends DELETE", async () => {
    const calls = mockApi(() => new Response(null, { status: 204 }));
    const onChanged = vi.fn();
    renderApp(<CuratorActions release={release(6, "Going Away", "2027-01-01", "day")} onChanged={onChanged} />, { signedIn: true });

    await userEvent.click(screen.getByRole("button", { name: "Hide Going Away" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Hide Going Away" }));
    expect(screen.getByRole("group", { name: "Hide Going Away?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, hide it" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ url: "/api/releases/6" });
  });
});

describe("ReleasesPage with curator tools", () => {
  const items = [release(1, "Some Book", "2027-01-01", "day")];

  it("a curator sees Edit and Hide on each release", async () => {
    installFakeEventSource();
    mockApi((url) => (url === "/api/me" ? json(curator) : json(page(items))));
    renderApp(<ReleasesPage />, { signedIn: true });
    const row = (await screen.findByText("Some Book")).closest("li") as HTMLElement;
    expect(await within(row).findByRole("button", { name: "Edit Some Book" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Hide Some Book" })).toBeInTheDocument();
  });

  it("a Reader and a signed-out visitor don't", async () => {
    installFakeEventSource();
    mockApi((url) => (url === "/api/me" ? json(reader) : json(page(items))));
    const { unmount } = renderApp(<ReleasesPage />, { signedIn: true });
    await screen.findByText("Some Book");
    await waitFor(() => expect(screen.queryByText("Checking")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    unmount();

    installFakeEventSource();
    mockApi(() => json(page(items)));
    renderApp(<ReleasesPage />);
    await screen.findByText("Some Book");
    expect(screen.queryByRole("button", { name: /^Hide / })).not.toBeInTheDocument();
  });
});
