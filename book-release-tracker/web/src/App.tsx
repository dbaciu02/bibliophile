import { useRemote } from "./useRemote";

interface Health {
  status: string;
  commit: string;
}

// Runtime check of the /healthz response (module-level so it's a stable reference).
function parseHealth(json: unknown): Health {
  if (typeof json === "object" && json !== null && "status" in json && "commit" in json) {
    const { status, commit } = json as { status: unknown; commit: unknown };
    if (typeof status === "string" && typeof commit === "string") return { status, commit };
  }
  throw new Error("Unexpected response from /healthz");
}

/**
 * Step 1 placeholder for the public page. It only shows API status for now,
 * but already uses the loading / error pattern every later call will use.
 */
export function App() {
  const { state, retry } = useRemote("/healthz", parseHealth);

  return (
    <main>
      <h1>Upcoming book releases</h1>
      <p>Release calendar, search and filters arrive in step 5.</p>

      <section aria-labelledby="api-status-heading">
        <h2 id="api-status-heading">API status</h2>
        <div role="status" aria-live="polite">
          {state.status === "loading" && <p>Checking the API…</p>}
          {state.status === "empty" && <p>No status returned.</p>}
          {state.status === "ready" && (
            <p>
              API is {state.data.status} (commit <code>{state.data.commit}</code>)
            </p>
          )}
          {state.status === "error" && (
            <>
              <p>
                Couldn’t reach the API: {state.message}
                {state.requestId && <> (request id <code>{state.requestId}</code>)</>}
              </p>
              <button type="button" onClick={retry}>
                Try again
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
