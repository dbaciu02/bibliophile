import { useState, type FormEvent } from "react";
import { apiRequest } from "../api/request";
import { parseWatchlist, WatchlistItem, type Watchlist } from "../api/schemas";
import { useAuth } from "../auth/AuthContext";
import { Remote } from "../components/Remote";
import { Link } from "../router";
import { useRemote } from "../useRemote";

/** The signed-in user's followed authors (any role). */
export function WatchlistPage() {
  const { auth, signIn } = useAuth();
  if (auth.status === "loading") return <p role="status">Checking sign-in…</p>;
  if (auth.status === "signedOut") {
    return (
      <>
        <h1>My watchlist</h1>
        <p>Sign in to follow authors and see how many upcoming releases each one has.</p>
        <button type="button" onClick={() => void signIn()}>
          Sign in with Microsoft
        </button>
      </>
    );
  }
  return <SignedInWatchlist />;
}

const isEmptyList = (w: Watchlist) => w.items.length === 0;
const parseItem = (j: unknown) => WatchlistItem.parse(j);

function SignedInWatchlist() {
  const { getAccessToken } = useAuth();
  const { state, retry } = useRemote("/api/me/watchlist", parseWatchlist, { getToken: getAccessToken, isEmpty: isEmptyList });

  return (
    <>
      <h1>My watchlist</h1>
      <AddAuthorForm onAdded={retry} />
      <Remote
        state={state}
        retry={retry}
        loading="Loading your watchlist…"
        empty={<p>You aren’t following any authors yet. Add one above.</p>}
      >
        {(list) => (
          <ul className="watchlist">
            {list.items.map((item) => (
              <WatchlistRow key={item.id} item={item} onRemoved={retry} />
            ))}
          </ul>
        )}
      </Remote>
    </>
  );
}

function AddAuthorForm({ onAdded }: { onAdded: () => void }) {
  const { getAccessToken } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setMessage({ kind: "error", text: "Enter an author’s name." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await apiRequest("POST", "/api/me/watchlist", {
      token: await getAccessToken(),
      body: { authorName: name.trim() },
      parse: parseItem,
    });
    setBusy(false);
    if (result.ok) {
      setMessage({ kind: "ok", text: `Now following ${result.data.author}.` });
      setName("");
      onAdded();
    } else {
      // 409 arrives here as "You are already watching …" from the API.
      setMessage({ kind: "error", text: result.message });
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <label htmlFor="add-author">Follow an author</label>
      <input id="add-author" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={busy} />
      <button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Follow"}
      </button>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : "ok"}>
          {message.text}
        </p>
      )}
    </form>
  );
}

function WatchlistRow({ item, onRemoved }: { item: WatchlistItem; onRemoved: () => void }) {
  const { getAccessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const result = await apiRequest("DELETE", `/api/me/watchlist/${item.id}`, { token: await getAccessToken() });
    setBusy(false);
    if (result.ok) onRemoved();
    else setError(result.message);
  };

  return (
    <li>
      <span className="title">{item.author}</span>{" "}
      <Link href={`/?author=${encodeURIComponent(item.author)}`}>
        {item.upcomingCount === 1 ? "1 upcoming release" : `${item.upcomingCount} upcoming releases`}
      </Link>{" "}
      <button type="button" className="secondary" onClick={() => void remove()} disabled={busy} aria-label={`Remove ${item.author}`}>
        {busy ? "Removing…" : "Remove"}
      </button>
      {error && (
        <span role="alert" className="error">
          {" "}
          {error}
        </span>
      )}
    </li>
  );
}
