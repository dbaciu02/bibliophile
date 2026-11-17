import type { ReactNode } from "react";
import type { RemoteState } from "../useRemote";

/**
 * Renders the three non-data states of a remote call the same way everywhere
 * (F2), and the data only when it's ready. `role="status"` + `aria-live` make
 * screen readers announce loading and errors (D9).
 */
export function Remote<T>({
  state,
  retry,
  loading,
  empty,
  children,
}: {
  state: RemoteState<T>;
  retry: () => void;
  loading: string;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}) {
  switch (state.status) {
    case "loading":
      return (
        <p role="status" aria-live="polite" className="state state-loading">
          <span className="spinner" aria-hidden="true" /> {loading}
        </p>
      );
    case "empty":
      return (
        <div role="status" aria-live="polite" className="state state-empty">
          {empty}
        </div>
      );
    case "error":
      return (
        <div role="alert" className="state state-error">
          <p>
            <strong>Something went wrong.</strong> {state.message}
          </p>
          {state.requestId && (
            <p className="muted">
              Reference: <code>{state.requestId}</code>
            </p>
          )}
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      );
    case "ready":
      return <>{children(state.data)}</>;
  }
}
