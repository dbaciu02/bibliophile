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
    B->>N: GET /api/releases?… (same origin, never a token)
    alt same query cached less than 60 s ago
        N-->>B: JSON from the CDN (Cache-Status: hit)
    else not cached (or a live update asked for a new ?v=<event id>)
        N->>R: proxy GET /api/releases?…
        R->>A: forwards (X-Forwarded-For/Proto)
        A->>P: SQL (parameterized), internal network
        P-->>A: rows
        A-->>N: JSON + Netlify-CDN-Cache-Control: 60 s (CDN) + Cache-Control: max-age=0 (browser) + ETag
        N-->>B: JSON (Cache-Status: fwd=miss), kept for 60 s
    end
    B->>D: lookup api.bibliophile.(your domain)
    D-->>B: CNAME → …onrender.com
    B->>R: personal reads and all writes, e.g. GET /api/me/watchlist (Origin: site, Authorization: Bearer …)
    R->>A: forwards (X-Forwarded-For/Proto)
    A->>A: request id · CORS allowlist · security headers · rate limit
    A->>A: verify JWT: signature (Entra keys), iss, aud, exp, scope, role
    A->>P: SQL (parameterized), internal network
    P-->>A: rows
    A-->>B: JSON + Cache-Control: private, no-store + Access-Control-Allow-Origin: site + X-Request-Id
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

    subgraph Edge["Public edge (Netlify CDN)"]
        N[Website files + cached public catalog<br/>no secrets, no user data]
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
    N -- "proxies GET /api/releases* only, no token;<br/>keeps public 200s for 60 s;<br/>personal routes are never proxied" --> A
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
| CDN → API (catalog proxy) | Netlify forwards the request unchanged | It's treated like any internet request. Only public catalog reads are proxied, the app never sends a token that way, and the API marks only successful catalog reads as CDN-cacheable; everything personal is `private, no-store` and isn't proxied at all |
| Internet → API | Only Entra's signature on a token | Everything else: Origin (CORS), token claims, every input (zod), request rate, Host header for /mcp |
| Browser ↔ Entra | Entra authenticates the user | The redirect back: `state` (CSRF) and `nonce` (replay), PKCE so a stolen code is useless |
| API → Postgres | The database itself | Nothing from users reaches SQL as text: parameters only. Each environment's login is confined to its own database |
| API → Google Books | That it's Google (TLS) | The response shape (zod), its speed (timeout), its availability (breaker, stale cache) |
| API → Grafana | Grafana stores what we send | What we send: no tokens, no API key (header, not URL), no SQL parameter values |
| GitHub → Render/Netlify | Actions runs our workflow | Production only takes a commit that staging reports healthy, and only stays on it if `/healthz` agrees |

Secrets never cross into the browser or the repository: they live in Render
(runtime), GitHub environments (deploy), and the developer's terminal (one-time
DB setup). See [secrets.md](secrets.md).

## 3. Data model (F4)

The tables from the three migrations in `api/migrations/`. Solid lines are
foreign keys. Dotted lines are links by value, deliberately not foreign keys:
audit rows must survive the deletion of what they describe, and confirmations
belong to a sign-in identity, not a stored user row.

```mermaid
erDiagram
    users ||--o{ watchlist_items : "follows (user_id)"
    authors ||--o{ watchlist_items : "is followed (author_id)"
    books ||--|{ book_authors : "written by (book_id)"
    authors ||--o{ book_authors : "writes (author_id)"
    users ||..o{ audit_log : "actor_subject = idp_subject"
    users ||..o{ mcp_confirmations : "subject = idp_subject"

    users {
        bigserial id PK
        text idp_subject UK "Entra oid claim"
        text display_name
        timestamptz created_at
    }
    authors {
        bigserial id PK
        text name UK
    }
    books {
        bigserial id PK
        text google_volume_id UK "duplicate import gives 409"
        text title "1 to 500 chars"
        date published_date "indexed"
        date_precision date_precision "year, month or day"
        text_array categories
        text thumbnail_url "nullable"
        boolean hidden
        timestamptz created_at
        timestamptz updated_at
    }
    book_authors {
        bigint book_id PK,FK
        bigint author_id PK,FK "indexed"
    }
    watchlist_items {
        bigserial id PK
        bigint user_id FK "unique with author_id"
        bigint author_id FK
        timestamptz created_at
    }
    audit_log {
        bigserial id PK
        timestamptz at
        text actor_subject "from the validated token"
        text actor_role
        text action
        text entity_type "indexed with entity_id"
        text entity_id
        jsonb before
        jsonb after
        text request_id
    }
    events {
        bigserial id PK "SSE event id, Last-Event-ID"
        text type
        jsonb payload
        timestamptz created_at
    }
    google_books_cache {
        text cache_key PK
        jsonb body
        timestamptz fetched_at
        timestamptz expires_at
    }
    mcp_confirmations {
        text token PK "one-time, 5 min"
        text subject
        text tool
        jsonb args
        timestamptz created_at
        timestamptz expires_at
        timestamptz used_at
    }
```

| Rule | Where it's enforced |
| --- | --- |
| A book can't be imported twice | `books.google_volume_id` UNIQUE → 409 |
| A user follows an author at most once | UNIQUE (`user_id`, `author_id`) on `watchlist_items` → 409 |
| Deleting a book or author removes its links | `ON DELETE CASCADE` on `book_authors`, `watchlist_items` |
| The audit log is append-only | a trigger rejects UPDATE, DELETE and TRUNCATE on `audit_log` |
| Release-calendar queries stay fast | index on `books.published_date` (see `evidence/index-explain.md`) |
| "Books by this author" stays fast | index on `book_authors.author_id` |
| Live-update ids are gap-free and ordered | `events.id` assigned under an advisory lock in the same transaction as the change |
