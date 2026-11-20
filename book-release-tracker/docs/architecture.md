# Architecture (Q2): request path and trust boundaries

## 1. Request path

What happens when someone opens the site and it loads the releases list.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant D as DNS (Porkbun)
    participant N as Netlify CDN<br/>bibliophile.(your domain)
    participant E as Entra ID<br/>login.microsoftonline.com
    participant R as Render proxy (TLS)<br/>api.bibliophile.(your domain)
    participant A as API container<br/>(Express)
    participant P as Postgres<br/>(bibliophile_prod)
    participant G as Google Books
    participant O as Grafana Cloud

    B->>D: lookup bibliophile.(your domain)
    D-->>B: CNAME → …netlify.app → edge IP
    B->>N: GET / (HTTPS)
    N-->>B: index.html (revalidated, ETag/304) + /assets/*.js (cached 1 year)
    opt signing in
        B->>E: authorize (PKCE, state, nonce)
        E-->>B: code → token request → access token (aud = booktracker-api)
    end
    B->>D: lookup api.bibliophile.(your domain)
    D-->>B: CNAME → …onrender.com
    B->>R: GET /api/releases (Origin: site) [+ Authorization: Bearer …]
    R->>A: forwards (X-Forwarded-For/Proto)
    A->>A: request id · CORS allowlist · security headers · rate limit
    A->>A: (protected routes) verify JWT: signature (Entra keys), iss, aud, exp, scope, role
    A->>P: SQL (parameterized), internal network
    P-->>A: rows
    A-->>B: JSON + Access-Control-Allow-Origin: site + X-Request-Id
    A--)O: spans, metrics, logs (OTLP, batched, async)
    Note over A,G: Curator search: API → Google Books (key in header, 3 s timeout,<br/>2 retries, circuit breaker, cached in Postgres)
    B->>R: GET /api/events (EventSource, long-lived)
    R->>A: stream
    A-->>B: release.created / updated / hidden, ping every 15 s
```

Deploys take a separate path (no user traffic):

```mermaid
flowchart LR
    Dev[git push main] --> GA[GitHub Actions<br/>typecheck + tests]
    GA --> IMG[Docker image → GHCR<br/>tag sha-commit, digest recorded]
    IMG --> RS[Render staging<br/>deploy hook + image digest]
    RS --> GATE{staging /healthz<br/>reports this commit?}
    GATE -- no --> STOP[stop: staging keeps<br/>the previous build]
    GATE -- yes --> NS[Netlify staging site<br/>if web/ changed] --> SMOKE[smoke checks]
    SMOKE --> PROMOTE[manual: promote sha]
    PROMOTE --> G2{healthy on staging?}
    G2 -- no --> STOP2[refused]
    G2 -- yes --> RP[Render production] --> G3{production /healthz<br/>reports it?}
    G3 -- no --> RB[automatic rollback<br/>to previous commit]
    G3 -- yes --> NP[Netlify production site]
```

## 2. Trust boundaries

Each dashed box is a zone that trusts what's inside it more than what crosses
into it. Every arrow that crosses a box is a boundary, and the label says
what is checked there.

```mermaid
flowchart TB
    subgraph Internet["Untrusted: the internet"]
        U[Browser / user]
        M[MCP host<br/>e.g. an AI assistant]
        X[Anyone else:<br/>scanners, other sites]
    end

    subgraph Edge["Public static edge (Netlify)"]
        N[Website files<br/>no secrets, no user data]
    end

    subgraph Idp["Identity provider (Microsoft Entra ID)"]
        E[Sign-in, issues tokens<br/>roles + scopes]
    end

    subgraph RenderNet["Render private network: the trusted core"]
        A[API container<br/>holds: DB URL, Google key, OTLP token]
        P[(Postgres<br/>per-environment login)]
    end

    subgraph Third["Third parties the API calls"]
        G[Google Books]
        O[Grafana Cloud]
    end

    subgraph CI["Build and deploy (GitHub)"]
        GA[Actions<br/>holds: deploy hooks, Netlify token]
        R[GHCR images]
    end

    U -- "HTTPS; CSP, HSTS" --> N
    U -- "OIDC: PKCE + state + nonce" --> E
    U -- "HTTPS; CORS exact-origin allowlist;<br/>JWT checked (sig, iss, aud, exp, scope, role);<br/>zod-validated input; per-user rate limits" --> A
    M -- "same JWT checks + per-tool scopes;<br/>write tool needs a server-issued<br/>one-time confirmation; Host header check" --> A
    X -- "same as any request; preflight from<br/>other origins refused (403)" --> A
    A -- "Entra signing keys (JWKS) fetched over HTTPS" --> E
    A -- "parameterized SQL only; login can't open<br/>the other environment's database" --> P
    A -- "API key in header; responses zod-validated;<br/>timeouts, retries, breaker" --> G
    A -- "telemetry without secrets or SQL values" --> O
    GA -- "image digest + deploy hook (secret)" --> A
    GA -- "push image (GITHUB_TOKEN)" --> R
    GA -- "upload static files (Netlify token)" --> N
```

### What each boundary assumes

| Boundary | We trust | We don't trust, so we check |
| --- | --- | --- |
| Internet → website | Netlify serves our files intact over TLS | Nothing to check: the site is public and holds no secrets. CSP limits what a page can load or call |
| Internet → API | Only Entra's signature on a token | Everything else: Origin (CORS), token claims, every input (zod), request rate, Host header for /mcp |
| Browser ↔ Entra | Entra authenticates the user | The redirect back: `state` (CSRF) and `nonce` (replay), PKCE so a stolen code is useless |
| API → Postgres | The database itself | Nothing from users reaches SQL as text: parameters only. Each environment's login is confined to its own database |
| API → Google Books | That it's Google (TLS) | The response shape (zod), its speed (timeout), its availability (breaker, stale cache) |
| API → Grafana | Grafana stores what we send | What we send: no tokens, no API key (header, not URL), no SQL parameter values |
| GitHub → Render/Netlify | Actions runs our workflow | Production only takes a commit that staging reports healthy, and only stays on it if `/healthz` agrees |

Secrets never cross into the browser or the repository: they live in Render
(runtime), GitHub environments (deploy), and the developer's terminal (one-time
DB setup). See [secrets.md](secrets.md).
