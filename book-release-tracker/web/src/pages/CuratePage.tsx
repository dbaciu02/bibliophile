import { useState, type FormEvent } from "react";
import { apiRequest } from "../api/request";
import { parseBookSearch, type BookCandidate, type BookSearch } from "../api/schemas";
import { useAuth } from "../auth/AuthContext";
import { hasRole, useMe } from "../auth/useMe";
import { Remote } from "../components/Remote";
import { formatReleaseDate } from "../format";
import { navigate, useLocation } from "../router";
import { useRemote } from "../useRemote";

/**
 * Curators search Google Books (through our API and its cache) and import
 * volumes into the catalog. The page hides itself from non-curators, but that
 * is only convenience: the API returns 403 to anyone else regardless.
 */
export function CuratePage() {
  const { auth, signIn } = useAuth();
  const { me } = useMe();
  const { search } = useLocation();
  const q = search.get("q")?.trim() ?? "";

  if (auth.status === "loading" || (auth.status === "signedIn" && me?.status === "loading")) {
    return <p role="status">Checking your access…</p>;
  }
  if (auth.status === "signedOut") {
    return (
      <>
        <h1>Curate</h1>
        <p>Curators sign in to add releases from Google Books.</p>
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

  return (
    <>
      <h1>Curate: add releases from Google Books</h1>
      <SearchForm key={q} initial={q} />
      {q.length >= 2 && <Results key={q} q={q} />}
    </>
  );
}

function SearchForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    navigate(v ? `/curate?q=${encodeURIComponent(v)}` : "/curate");
  };
  return (
    <form className="inline-form" role="search" onSubmit={submit}>
      <label htmlFor="g-q">Search Google Books</label>
      <input id="g-q" type="search" value={value} onChange={(e) => setValue(e.target.value)} minLength={2} maxLength={200} required />
      <button type="submit">Search</button>
    </form>
  );
}

const isEmptySearch = (s: BookSearch) => s.items.length === 0;

function Results({ q }: { q: string }) {
  const { getAccessToken } = useAuth();
  const { state, retry } = useRemote(`/api/books/search?q=${encodeURIComponent(q)}&maxResults=10`, parseBookSearch, {
    getToken: getAccessToken,
    isEmpty: isEmptySearch,
  });

  return (
    <Remote state={state} retry={retry} loading="Searching Google Books…" empty={<p>Google Books found nothing for “{q}”.</p>}>
      {(result) => (
        <>
          {result.source === "stale" && (
            <p role="status" className="banner">
              Google Books isn’t responding, so these are saved results from{" "}
              {new Date(result.fetchedAt).toLocaleString()}. They may be out of date.
            </p>
          )}
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
