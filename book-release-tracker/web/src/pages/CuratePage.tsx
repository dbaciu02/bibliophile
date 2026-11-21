import { useState, type FormEvent } from "react";
import { apiRequest } from "../api/request";
import { parseBookSearch, type BookCandidate, type BookSearch } from "../api/schemas";
import { useAuth } from "../auth/AuthContext";
import { hasRole, useMe } from "../auth/useMe";
import { Remote } from "../components/Remote";
import { formatReleaseDate } from "../format";
import { navigate, useLocation } from "../router";
import { useRemote } from "../useRemote";
import { AddReleaseForm } from "../components/ReleaseEditor";

/**
 * Curators add releases two ways: by hand (AddReleaseForm, for books Google
 * doesn't have or made-up test data), or by searching Google Books (through
 * our API and its cache) and importing volumes. Edit and Hide are on each
 * release row of the releases page. The page hides itself from non-curators, but that
 * is only convenience: the API returns 403 to anyone else regardless.
 *
 * The search form's fields map to Google's field searches (title, author,
 * subject, publisher, ISBN). Google can't filter by date, so Year and
 * "Upcoming only" are applied by our API to the results Google returns.
 * Everything lives in the URL (/curate?author=…&year=2027), so a search can
 * be repeated or shared.
 */

const TEXT_FIELDS = ["q", "title", "author", "subject", "publisher", "isbn"] as const;
const ALL_FIELDS = [...TEXT_FIELDS, "year", "upcomingOnly", "orderBy"] as const;
type Field = (typeof ALL_FIELDS)[number];
type Values = Record<Field, string>;

function valuesFrom(search: URLSearchParams): Values {
  const v = {} as Values;
  for (const k of ALL_FIELDS) v[k] = search.get(k) ?? "";
  return v;
}

/** Only the fields the user filled in, in a stable order. */
function toParams(v: Values): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of ALL_FIELDS) {
    const val = v[k].trim();
    if (!val) continue;
    if (k === "upcomingOnly" && val !== "true") continue;
    if (k === "orderBy" && val === "relevance") continue;
    p.set(k, val);
  }
  return p;
}

const hasTextField = (v: Values) => TEXT_FIELDS.some((k) => v[k].trim().length > 0);

export function CuratePage() {
  const { auth, signIn } = useAuth();
  const { me } = useMe();
  const { search } = useLocation();

  if (auth.status === "loading" || (auth.status === "signedIn" && me?.status === "loading")) {
    return <p role="status">Checking your access…</p>;
  }
  if (auth.status === "signedOut") {
    return (
      <>
        <h1>Curate</h1>
        <p>Curators sign in to add, import and edit releases.</p>
        <button type="button" onClick={() => void signIn()}>
          Sign in with Microsoft
        </button>
      </>
    );
  }
  if (!hasRole(me, "Curator")) {
    return (
      <>
        <h1>Curate</h1>
        <p>This page is for curators. Your account doesn’t have the Curator role.</p>
      </>
    );
  }

  const current = valuesFrom(search);
  const params = toParams(current);
  const key = params.toString();

  return (
    <>
      <h1>Curate</h1>
      <AddReleaseForm />
      <h2>Add from Google Books</h2>
      {/* Keys must differ between siblings, or React can leave an old copy on screen. */}
      <SearchForm key={`form:${key}`} initial={current} />
      {hasTextField(current) && <Results key={`results:${key}`} params={params} values={current} />}
    </>
  );
}

function SearchForm({ initial }: { initial: Values }) {
  const [v, setV] = useState<Values>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: Field) => (e: { target: { value: string } }) => setV((old) => ({ ...old, [k]: e.target.value }));

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 1 + i)); // last year … 4 years ahead
  if (v.year && !years.includes(v.year)) years.push(v.year); // keep a year from a shared link selectable

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!hasTextField(v)) {
      setError("Fill in at least one of Keywords, Title, Author, Subject, Publisher or ISBN. Google can’t search by year alone.");
      return;
    }
    setError(null);
    const qs = toParams(v).toString();
    navigate(qs ? `/curate?${qs}` : "/curate");
  };

  const clear = () => {
    setError(null);
    navigate("/curate");
  };

  return (
    <form className="curate-form" role="search" onSubmit={submit} noValidate aria-describedby="curate-help">
      <p id="curate-help" className="muted">
        Fill in any of the fields; they’re combined. Year and “Upcoming only” filter the results Google sends back.
      </p>

      <div className="grid">
        <div className="field span-2">
          <label htmlFor="g-q">Keywords</label>
          <input id="g-q" type="search" value={v.q} onChange={set("q")} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="g-title">Title</label>
          <input id="g-title" value={v.title} onChange={set("title")} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="g-author">Author</label>
          <input id="g-author" value={v.author} onChange={set("author")} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="g-subject">Subject / category</label>
          <input id="g-subject" value={v.subject} onChange={set("subject")} placeholder="e.g. Fiction" maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor="g-year">Year</label>
          <select id="g-year" value={v.year} onChange={set("year")}>
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="g-order">Sort</label>
          <select id="g-order" value={v.orderBy || "relevance"} onChange={set("orderBy")}>
            <option value="relevance">Most relevant</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <div className="field checkbox">
          <input
            id="g-upcoming"
            type="checkbox"
            checked={v.upcomingOnly === "true"}
            onChange={(e) => setV((old) => ({ ...old, upcomingOnly: e.target.checked ? "true" : "" }))}
          />
          <label htmlFor="g-upcoming">Upcoming only</label>
        </div>
      </div>

      <details open={Boolean(initial.publisher || initial.isbn)}>
        <summary>More fields</summary>
        <div className="grid">
          <div className="field">
            <label htmlFor="g-publisher">Publisher</label>
            <input id="g-publisher" value={v.publisher} onChange={set("publisher")} maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="g-isbn">ISBN</label>
            <input id="g-isbn" value={v.isbn} onChange={set("isbn")} inputMode="numeric" placeholder="10 or 13 digits" maxLength={17} />
          </div>
        </div>
      </details>

      <div className="actions">
        <button type="submit">Search</button>
        <button type="button" className="secondary" onClick={clear}>
          Clear
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

const isEmptySearch = (s: BookSearch) => s.items.length === 0;

function Results({ params, values }: { params: URLSearchParams; values: Values }) {
  const { getAccessToken } = useAuth();
  const apiParams = new URLSearchParams(params);
  apiParams.set("maxResults", "20");
  const { state, retry } = useRemote(`/api/books/search?${apiParams.toString()}`, parseBookSearch, {
    getToken: getAccessToken,
    // Not "empty" when the date filter hid results: we want to explain that instead.
    isEmpty: isEmptySearch,
  });
  const dateFilterOn = Boolean(values.year) || values.upcomingOnly === "true";

  return (
    <Remote
      state={state}
      retry={retry}
      loading="Searching Google Books…"
      empty={
        <p>
          No results.{" "}
          {dateFilterOn
            ? "Google found books, but none matched the year / upcoming filter. Try removing it, or sort by Newest first."
            : "Google Books found nothing for this search."}
        </p>
      }
    >
      {(result) => (
        <>
          {result.source === "stale" && (
            <p role="status" className="banner">
              Google Books isn’t responding, so these are saved results from{" "}
              {new Date(result.fetchedAt).toLocaleString()}. They may be out of date.
            </p>
          )}
          <p className="muted result-summary">
            Showing {result.items.length} of about {result.totalItems.toLocaleString()} Google matches
            {result.hiddenByDateFilter > 0 && <> · {result.hiddenByDateFilter} hidden by the date filter</>}
            {" · "}
            <span title="The search sent to Google Books">
              query: <code>{result.googleQuery}</code>
            </span>
          </p>
          <ul className="candidates">
            {result.items.map((c) => (
              <CandidateRow key={c.googleVolumeId} candidate={c} />
            ))}
          </ul>
        </>
      )}
    </Remote>
  );
}

function CandidateRow({ candidate: c }: { candidate: BookCandidate }) {
  const { getAccessToken } = useAuth();
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">(c.inCatalog ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  const importIt = async () => {
    setStatus("busy");
    setError(null);
    const result = await apiRequest("POST", "/api/releases/import", {
      token: await getAccessToken(),
      body: { googleVolumeId: c.googleVolumeId },
    });
    if (result.ok || result.status === 409) {
      setStatus("done"); // 409 = someone already imported it: same end state
    } else {
      setStatus("error");
      setError(result.message);
    }
  };

  const importable = c.releaseDate !== null && c.authors.length > 0;

  return (
    <li className="release">
      {c.thumbnailUrl ? (
        <img src={c.thumbnailUrl} alt="" width={64} height={96} loading="lazy" />
      ) : (
        <div className="cover-placeholder" aria-hidden="true" />
      )}
      <div>
        <p className="title">{c.title}</p>
        <p className="muted">{c.authors.join(", ") || "No author listed"}</p>
        <p>
          {c.releaseDate && c.datePrecision ? (
            <time dateTime={c.releaseDate}>{formatReleaseDate(c.releaseDate, c.datePrecision)}</time>
          ) : (
            <span className="muted">No usable release date ({c.publishedDateRaw ?? "none"})</span>
          )}
          {c.categories.length > 0 && <span className="tag">{c.categories.join(", ")}</span>}
        </p>
        {status === "done" ? (
          <p className="ok">In the catalog ✓</p>
        ) : importable ? (
          <button type="button" onClick={() => void importIt()} disabled={status === "busy"} aria-label={`Import ${c.title}`}>
            {status === "busy" ? "Importing…" : "Import"}
          </button>
        ) : (
          <p className="muted">Can’t import automatically (missing date or author).</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
