import { useEffect, useRef, useState } from "react";
import { formatReleaseDate, groupReleases } from "./format";
import { FollowResult, parseResult, type Calendar, type ToolResultLike } from "./result";

export type FollowCall = (authorName: string, confirmationToken?: string) => Promise<ToolResultLike>;

type FollowState =
  | { kind: "asking" }
  | { kind: "adding" }
  | { kind: "following"; upcomingCount: number }
  | { kind: "error"; message: string };

interface Pending {
  author: string;
  question: string;
  token: string;
}

export interface CalendarViewProps {
  calendar: Calendar;
  months: number;
  onMonthsChange: (months: number) => void;
  loading: boolean;
  follow: FollowCall;
}

/**
 * The calendar itself, with no MCP plumbing, so it can be tested directly.
 *
 * Following an author is two tool calls, by design (F12/D9): the first asks
 * the server for a confirmation question and a one-time token and writes
 * nothing; only after the person presses Confirm here does the app send the
 * second call with that token. The server enforces this, not the app: a call
 * without a valid token never writes.
 */
export function CalendarView({ calendar, months, onMonthsChange, loading, follow }: CalendarViewProps) {
  const [states, setStates] = useState<Record<string, FollowState>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Move focus into the question when it opens, and back to the Follow
  // button when it closes (after the re-render that re-enables that button).
  useEffect(() => {
    if (pending) confirmRef.current?.focus();
    else if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, [pending]);

  const setState = (author: string, s: FollowState | undefined) =>
    setStates((prev) => {
      const next = { ...prev };
      if (s) next[author] = s;
      else delete next[author];
      return next;
    });

  async function startFollow(author: string, button: HTMLElement) {
    returnFocus.current = button;
    setState(author, { kind: "asking" });
    const parsed = parseResult(FollowResult, await follow(author).catch(toErrorResult));
    if (!parsed.ok) return setState(author, { kind: "error", message: parsed.message });
    if (parsed.value.status === "confirmation_required") {
      setPending({ author, question: parsed.value.question, token: parsed.value.confirmationToken });
    } else {
      setState(author, { kind: "following", upcomingCount: parsed.value.item.upcomingCount });
    }
  }

  async function confirm() {
    if (!pending) return;
    const { author, token } = pending;
    setPending(null);
    setState(author, { kind: "adding" });
    const parsed = parseResult(FollowResult, await follow(author, token).catch(toErrorResult));
    if (parsed.ok && parsed.value.status === "added") {
      setState(author, { kind: "following", upcomingCount: parsed.value.item.upcomingCount });
    } else {
      setState(author, { kind: "error", message: parsed.ok ? "Unexpected reply from the server." : parsed.message });
    }
  }

  function cancel() {
    if (!pending) return;
    setState(pending.author, undefined);
    setPending(null);
  }

  const groups = groupReleases(calendar.releases);
  const { author, category } = calendar.filters;
  const scope = [author && `by “${author}”`, category && `in ${category}`].filter(Boolean).join(" ");

  return (
    <main aria-busy={loading}>
      <header className="bar">
        <h1>
          Upcoming releases{scope ? ` ${scope}` : ""}
        </h1>
        <label>
          Show next{" "}
          <select value={months} onChange={(e) => onMonthsChange(Number(e.target.value))} disabled={loading}>
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {m} {m === 1 ? "month" : "months"}
              </option>
            ))}
          </select>
        </label>
      </header>

      {pending && (
        <div role="alertdialog" aria-modal="false" aria-labelledby="confirm-q" className="confirm" onKeyDown={(e) => e.key === "Escape" && cancel()}>
          <p id="confirm-q">{pending.question}</p>
          <div className="actions">
            <button ref={confirmRef} type="button" className="primary" onClick={() => void confirm()}>
              Confirm
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="empty">No releases between {calendar.from} and {calendar.to}. Try a longer range.</p>
      ) : (
        groups.map((g) => (
          <section key={g.label} aria-labelledby={`h-${g.label}`}>
            <h2 id={`h-${g.label}`}>{g.label}</h2>
            <ul>
              {g.items.map((r) => (
                <li key={r.id} className="release">
                  {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" width={40} height={60} /> : <div className="cover" aria-hidden="true" />}
                  <div>
                    <p className="title">{r.title}</p>
                    <p className="meta">
                      <time dateTime={r.releaseDate}>{formatReleaseDate(r.releaseDate, r.datePrecision)}</time>
                      {r.categories.length > 0 && ` · ${r.categories.join(", ")}`}
                    </p>
                    <p className="authors">
                      {r.authors.map((a) => (
                        <FollowButton key={a} author={a} state={states[a]} disabled={pending !== null} onFollow={startFollow} />
                      ))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="sr-only" aria-live="polite">
        {Object.entries(states)
          .map(([a, s]) => (s.kind === "following" ? `Now following ${a}.` : s.kind === "error" ? `Couldn't follow ${a}: ${s.message}` : ""))
          .join(" ")}
      </p>
    </main>
  );
}

function FollowButton({
  author,
  state,
  disabled,
  onFollow,
}: {
  author: string;
  state: FollowState | undefined;
  disabled: boolean;
  onFollow: (author: string, el: HTMLElement) => Promise<void>;
}) {
  if (state?.kind === "following") {
    return (
      <span className="followed">
        {author} · <strong>Following</strong>
      </span>
    );
  }
  const busy = state?.kind === "asking" || state?.kind === "adding";
  return (
    <span className="author">
      {author}{" "}
      <button type="button" aria-label={`Follow ${author}`} disabled={disabled || busy} onClick={(e) => void onFollow(author, e.currentTarget)}>
        {busy ? "…" : "Follow"}
      </button>
      {state?.kind === "error" && <span className="error"> {state.message}</span>}
    </span>
  );
}

/** A rejected call (the host or server refused it) as an isError result. */
export function toErrorResult(err: unknown): ToolResultLike {
  const message = err instanceof Error ? err.message : String(err);
  const text = /insufficient.scope/i.test(message)
    ? "Your sign-in doesn't include permission to change your watchlist. Sign in again and allow “Watchlist.ReadWrite”."
    : `The request didn't go through (${message}).`;
  return { isError: true, content: [{ type: "text", text }] };
}
