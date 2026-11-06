import { useAuth } from "./auth/AuthContext";
import { useRemote } from "./useRemote";

interface Health {
  status: string;
  commit: string;
}

interface Me {
  subject: string;
  name: string;
  roles: string[];
  scopes: string[];
}

// Runtime checks of the API's responses (module-level so they're stable references).
function parseHealth(json: unknown): Health {
  if (typeof json === "object" && json !== null && "status" in json && "commit" in json) {
    const { status, commit } = json as { status: unknown; commit: unknown };
    if (typeof status === "string" && typeof commit === "string") return { status, commit };
  }
  throw new Error("Unexpected response from /healthz");
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function parseMe(json: unknown): Me {
  if (typeof json === "object" && json !== null) {
    const { subject, name, roles, scopes } = json as Record<string, unknown>;
    if (typeof subject === "string" && typeof name === "string" && isStringArray(roles) && isStringArray(scopes)) {
      return { subject, name, roles, scopes };
    }
  }
  throw new Error("Unexpected response from /api/me");
}

/**
 * Step 3 page: sign in / out, and show who the API says you are.
 * The release calendar, search and watchlist pages arrive in step 5.
 */
export function App() {
  const { auth, signIn, signOut } = useAuth();
  const health = useRemote("/healthz", parseHealth);

  return (
    <main>
      <header>
        <h1>Upcoming book releases</h1>
        <div aria-live="polite">
          {auth.status === "loading" && <p>Checking sign-in…</p>}
          {auth.status === "signedOut" && (
            <>
              {auth.error && <p role="alert">Sign-in failed: {auth.error}</p>}
              <button type="button" onClick={() => void signIn()}>
                Sign in with Microsoft
              </button>
            </>
          )}
          {auth.status === "signedIn" && (
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <p>Release calendar, search and filters arrive in step 5.</p>

      {auth.status === "signedIn" && (
        // keyed on the account so the request re-runs after a different user signs in
        <WhoAmI key={auth.user.profile.sub} />
      )}

      <section aria-labelledby="api-status-heading">
        <h2 id="api-status-heading">API status</h2>
        <div role="status" aria-live="polite">
          {health.state.status === "loading" && <p>Checking the API…</p>}
          {health.state.status === "empty" && <p>No status returned.</p>}
          {health.state.status === "ready" && (
            <p>
              API is {health.state.data.status} (commit <code>{health.state.data.commit}</code>)
            </p>
          )}
          {health.state.status === "error" && (
            <>
              <p>
                Couldn’t reach the API: {health.state.message}
                {health.state.requestId && <> (request id <code>{health.state.requestId}</code>)</>}
              </p>
              <button type="button" onClick={health.retry}>
                Try again
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

/** Calls GET /api/me with the access token: the API's view of the validated token. */
function WhoAmI() {
  const { getAccessToken } = useAuth();
  const { state, retry } = useRemote("/api/me", parseMe, { getToken: getAccessToken });

  return (
    <section aria-labelledby="whoami-heading">
      <h2 id="whoami-heading">Signed in</h2>
      <div role="status" aria-live="polite">
        {state.status === "loading" && <p>Asking the API who you are…</p>}
        {state.status === "empty" && <p>The API returned no identity.</p>}
        {state.status === "ready" && (
          <dl>
            <dt>Name</dt>
            <dd>{state.data.name}</dd>
            <dt>Roles (from the validated token)</dt>
            <dd>{state.data.roles.length > 0 ? state.data.roles.join(", ") : "none — ask an admin to assign one"}</dd>
            <dt>Scopes</dt>
            <dd>{state.data.scopes.join(", ")}</dd>
          </dl>
        )}
        {state.status === "error" && (
          <>
            <p>
              The API rejected your token ({state.httpStatus ?? "network error"}): {state.message}
              {state.requestId && <> (request id <code>{state.requestId}</code>)</>}
            </p>
            {state.httpStatus === 401 && (
              <p>
                If this persists, check the API's terminal for a <code>token rejected</code> line saying which check
                failed, and see <code>docs/entra-id-setup.md</code> step 5.
              </p>
            )}
            <button type="button" onClick={retry}>
              Try again
            </button>
          </>
        )}
      </div>
    </section>
  );
}
