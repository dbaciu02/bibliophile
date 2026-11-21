import { useCallback, useRef, useState, type FormEvent } from "react";
import { parseReleasePage, type Release, type ReleasePage } from "../api/schemas";
import { Remote } from "../components/Remote";
import { formatReleaseDate, groupReleases } from "../format";
import { LiveLog, LiveStatusPill } from "../live/LiveStatus";
import { useLiveEvents, type LiveEvent } from "../live/useLiveEvents";
import { navigate, useLocation } from "../router";
import { useRemote } from "../useRemote";
import { hasRole, useMe } from "../auth/useMe";
import { CuratorActions } from "../components/ReleaseEditor";

/**
 * The public page (F1): upcoming releases with search and filters. No sign-in
 * needed. Filters live in the URL (?q=…&from=…), so a filtered view can be
 * bookmarked or shared, and the Back button undoes a search.
 *
 * By default only UPCOMING releases are shown (`from` = today). Ticking
 * "Include past releases" (?past=1) drops that default so books that are
 * already out appear too. An explicit From date always wins.
 *
 * Live updates (F11): when a curator adds, edits or hides a book, the list
 * re-fetches itself quietly (same filters, no loading flash), new books get a
 * "New" tag, and screen readers hear what changed.
 */

const FILTERS = ["q", "author", "category", "from", "to"] as const;
type Filter = (typeof FILTERS)[number];
const PAGE_SIZE = 20;

const isEmptyPage = (p: ReleasePage) => p.items.length === 0;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReleasesPage() {
  const { search } = useLocation();

  // What the API is asked for: exactly what's in the URL. With no `from`,
  // default to today so the page shows UPCOMING releases.
  const apiParams = new URLSearchParams();
  for (const key of FILTERS) {
    const v = search.get(key)?.trim();
    if (v) apiParams.set(key, v);
  }
  const includePast = search.get("past") === "1";
  if (!apiParams.has("from") && !includePast) apiParams.set("from", todayIso());
  const offset = Number(search.get("offset") ?? 0) || 0;
  apiParams.set("limit", String(PAGE_SIZE));
  if (offset > 0) apiParams.set("offset", String(offset));

  const { state, retry, refresh } = useRemote(`/api/releases?${apiParams.toString()}`, parseReleasePage, {
    isEmpty: isEmptyPage,
    cdn: true, // public catalog: served through the site's CDN (D6)
  });
  const filtered = FILTERS.some((k) => search.get(k));

  // Curators get Edit / Hide on each row (the API enforces the role regardless).
  const { me } = useMe();
  const curator = hasRole(me, "Curator");
  // After a curator's own change: refetch a fresh copy (new cache key) at once,
  // without waiting for the live event, which also arrives and refetches.
  const afterEdit = useCallback(() => refresh(String(Date.now())), [refresh]);

  // ---- live updates
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLive = useCallback(
    (e: LiveEvent) => {
      const title = e.data.title ? `“${e.data.title}”` : "A release";
      if (e.type === "release.created" && e.data.id !== undefined) {
        const id = e.data.id;
        setNewIds((old) => new Set(old).add(id));
        setAnnouncement(`${title} was added.`);
      } else if (e.type === "release.updated") {
        setAnnouncement(`${title} was updated.`);
      } else if (e.type === "release.hidden") {
        setAnnouncement("A release was removed.");
      }
      // Coalesce bursts (e.g. a curator importing several books) into one re-fetch.
      // A real change (id > 0) refetches with ?v=<event id>: a cache key the CDN
      // has never served before that change, so the list is fresh at once.
      // "connected" (id 0) only re-checks, and may be answered from cache.
      const version = e.id > 0 ? String(e.id) : undefined;
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => refresh(version), 250);
    },
    [refresh],
  );
  const live = useLiveEvents(onLive);

  return (
    <>
      <div className="page-title">
        <h1>{includePast ? "Book releases" : "Upcoming book releases"}</h1>
        <LiveStatusPill status={live.status} />
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <FilterForm key={search.toString()} initial={search} />
      <LiveLog log={live.log} />

      <section aria-labelledby="results-heading">
        <h2 id="results-heading" className="visually-hidden">
          Results
        </h2>
        <Remote
          state={state}
          retry={retry}
          loading="Loading releases…"
          empty={
            filtered ? (
              <p>
                No releases match these filters.{" "}
                <button type="button" className="link" onClick={() => navigate("/")}>
                  Clear filters
                </button>
              </p>
            ) : includePast ? (
              <p>The catalog is empty.</p>
            ) : (
              <p>
                No upcoming releases in the catalog yet. Books that are already out are hidden; tick{" "}
                <strong>Include past releases</strong> to see them.
              </p>
            )
          }
        >
          {(page) => <ReleaseList page={page} offset={offset} search={search} newIds={newIds} curator={curator} onChanged={afterEdit} />}
        </Remote>
      </section>
    </>
  );
}

function FilterForm({ initial }: { initial: URLSearchParams }) {
  const [values, setValues] = useState<Record<Filter, string>>(() => {
    const v = {} as Record<Filter, string>;
    for (const k of FILTERS) v[k] = initial.get(k) ?? "";
    return v;
  });
  const [past, setPast] = useState(initial.get("past") === "1");
  const set = (k: Filter) => (e: { target: { value: string } }) => setValues((old) => ({ ...old, [k]: e.target.value }));

  const go = (includePast: boolean) => {
    const next = new URLSearchParams();
    for (const k of FILTERS) if (values[k].trim()) next.set(k, values[k].trim());
    if (includePast) next.set("past", "1");
    const qs = next.toString();
    navigate(qs ? `/?${qs}` : "/");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(past);
  };

  return (
    <form className="filters" role="search" onSubmit={submit}>
      <div className="field grow">
        <label htmlFor="f-q">Title</label>
        <input id="f-q" type="search" value={values.q} onChange={set("q")} placeholder="Search titles" maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="f-author">Author</label>
        <input id="f-author" value={values.author} onChange={set("author")} maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="f-category">Category</label>
        <input id="f-category" value={values.category} onChange={set("category")} placeholder="e.g. Fiction" maxLength={100} />
      </div>
      <div className="field">
        <label htmlFor="f-from">From</label>
        <input id="f-from" type="date" value={values.from} onChange={set("from")} />
      </div>
      <div className="field">
        <label htmlFor="f-to">To</label>
        <input id="f-to" type="date" value={values.to} onChange={set("to")} />
      </div>
      <div className="field checkbox">
        <input
          id="f-past"
          type="checkbox"
          checked={past}
          onChange={(e) => {
            // Applies straight away, like a view switch; keeps whatever is typed in the other fields.
            setPast(e.target.checked);
            go(e.target.checked);
          }}
        />
        <label htmlFor="f-past">Include past releases</label>
      </div>
      <div className="field actions">
        <button type="submit">Search</button>
      </div>
    </form>
  );
}

function ReleaseList({
  page,
  offset,
  search,
  newIds,
  curator,
  onChanged,
}: {
  page: ReleasePage;
  offset: number;
  search: URLSearchParams;
  newIds: ReadonlySet<number>;
  curator: boolean;
  onChanged: () => void;
}) {
  // One heading per month (or "Sometime in YYYY"), each heading once.
  const groups = groupReleases<Release>(page.items);

  const pageLink = (newOffset: number) => {
    const next = new URLSearchParams(search);
    if (newOffset > 0) next.set("offset", String(newOffset));
    else next.delete("offset");
    const qs = next.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <>
      {groups.map((g) => (
        <section key={g.label} className="month" aria-label={g.label}>
          <h3>{g.label}</h3>
          <ul className="releases">
            {g.items.map((r) => (
              <li key={r.id} className="release">
                {r.thumbnailUrl ? (
                  <img src={r.thumbnailUrl} alt="" width={64} height={96} loading="lazy" />
                ) : (
                  <div className="cover-placeholder" aria-hidden="true" />
                )}
                <div>
                  <p className="title">
                    {r.title}
                    {newIds.has(r.id) && <span className="tag tag-new">New</span>}
                  </p>
                  <p className="muted">{r.authors.join(", ")}</p>
                  <p>
                    <time dateTime={r.releaseDate}>{formatReleaseDate(r.releaseDate, r.datePrecision)}</time>
                    {r.categories.length > 0 && <span className="tag">{r.categories.join(", ")}</span>}
                  </p>
                  {curator && <CuratorActions release={r} onChanged={onChanged} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <nav className="pager" aria-label="Pages">
        {offset > 0 && (
          <button type="button" onClick={() => navigate(pageLink(Math.max(0, offset - page.limit)))}>
            ← Earlier
          </button>
        )}
        {page.nextOffset !== null && (
          <button type="button" onClick={() => navigate(pageLink(page.nextOffset ?? 0))}>
            Later →
          </button>
        )}
      </nav>
    </>
  );
}
