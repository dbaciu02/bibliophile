# API image (Render runs this; built and pushed by .github/workflows/deploy.yml).
# Contains the compiled API, its SQL migrations and the built MCP App. No
# secrets: everything sensitive arrives as environment variables at runtime.

# ---- build: compile the API and the MCP App ---------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY mcp-app/package.json mcp-app/
RUN npm ci --no-audit --no-fund
COPY api api
COPY mcp-app mcp-app
RUN npm run build --workspace api && npm run build --workspace mcp-app

# ---- runtime: production dependencies only, non-root ------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY mcp-app/package.json mcp-app/
RUN npm ci --omit=dev --workspace api --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY api/migrations api/migrations
COPY --from=build /app/mcp-app/dist/release-calendar.html mcp-app/dist/release-calendar.html

# The commit this image was built from; /healthz reports it, and the pipeline
# only promotes a deploy once /healthz answers with the expected commit.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA \
    PORT=10000 \
    MCP_APP_HTML=/app/mcp-app/dist/release-calendar.html

USER node
WORKDIR /app/api
EXPOSE 10000
# Apply pending migrations (node-pg-migrate takes a lock, so two starting
# instances can't both run them), then replace the shell with the server so
# it receives SIGTERM directly and shuts down gracefully.
CMD ["sh", "-c", "/app/node_modules/.bin/node-pg-migrate up --migrations-dir migrations && exec node dist/server.js"]
