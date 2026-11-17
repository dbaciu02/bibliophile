import { parseHealth } from "./api/schemas";
import { useAuth } from "./auth/AuthContext";
import { hasRole, useMe } from "./auth/useMe";
import { CuratePage } from "./pages/CuratePage";
import { ReleasesPage } from "./pages/ReleasesPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { Link, useLocation } from "./router";
import { useRemote } from "./useRemote";

export function App() {
  const { path } = useLocation();

  let page;
  switch (path) {
    case "/":
      page = <ReleasesPage />;
      break;
    case "/watchlist":
      page = <WatchlistPage />;
      break;
    case "/curate":
      page = <CuratePage />;
      break;
    default:
      page = (
        <>
          <h1>Page not found</h1>
          <p>
            <Link href="/">Back to upcoming releases</Link>
          </p>
        </>
      );
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header path={path} />
      <main id="main" tabIndex={-1}>
        {page}
      </main>
      <Footer />
    </>
  );
}

function Header({ path }: { path: string }) {
  const { auth, signIn, signOut } = useAuth();
  const { me, retry } = useMe();
  const navLink = (href: string, label: string) => (
    <Link href={href} aria-current={path === href ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <header className="site-header">
      <nav aria-label="Main">
        <span className="brand">📚 Bibliophile</span>
        {navLink("/", "Releases")}
        {navLink("/watchlist", "My watchlist")}
        {hasRole(me, "Curator") && navLink("/curate", "Curate")}
      </nav>
      <div className="account" aria-live="polite">
        {auth.status === "loading" && <span className="muted">Checking sign-in…</span>}
        {auth.status === "signedOut" && (
          <>
            {auth.error && (
              <span role="alert" className="error">
                Sign-in failed: {auth.error}{" "}
              </span>
            )}
            <button type="button" onClick={() => void signIn()}>
              Sign in
            </button>
          </>
        )}
        {auth.status === "signedIn" && (
          <>
            {me?.status === "ready" && (
              <span>
                {me.data.name} <span className="tag">{me.data.roles.join(", ") || "no role"}</span>{" "}
              </span>
            )}
            {me?.status === "error" && (
              <span role="alert" className="error">
                Couldn’t load your account ({me.message}){" "}
                <button type="button" className="link" onClick={retry}>
                  retry
                </button>{" "}
              </span>
            )}
            <button type="button" className="secondary" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function Footer() {
  const { state, retry } = useRemote("/healthz", parseHealth);
  return (
    <footer className="site-footer muted">
      {state.status === "loading" && "Checking the API…"}
      {state.status === "ready" && (
        <>
          API {state.data.status} · commit <code>{state.data.commit}</code>
        </>
      )}
      {state.status === "error" && (
        <span role="alert">
          API unreachable ({state.message}){" "}
          <button type="button" className="link" onClick={retry}>
            retry
          </button>
        </span>
      )}
    </footer>
  );
}
