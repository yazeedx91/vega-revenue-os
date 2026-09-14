ARG GIT_SHA=unknown
ARG CERTIFIED_RELEASE=unknown
ARG GIT_REPO=unknown

FROM node:22-bookworm AS builder
ARG GIT_SHA
ARG CERTIFIED_RELEASE
ARG GIT_REPO

LABEL org.opencontainers.image.source="${GIT_REPO}"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${CERTIFIED_RELEASE}"
LABEL org.opencontainers.image.title="ProjectX Temporal Worker"

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build

RUN pnpm --filter @projectx/temporal-worker deploy --legacy /prod/worker

FROM node:22-bookworm-slim AS runtime
ARG GIT_SHA
ARG CERTIFIED_RELEASE
ARG GIT_REPO

LABEL org.opencontainers.image.source="${GIT_REPO}"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${CERTIFIED_RELEASE}"
LABEL org.opencontainers.image.title="ProjectX Temporal Worker"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /prod/worker
COPY --from=builder --chown=node:node /prod/worker .

USER node
EXPOSE 3001

CMD ["node", "dist/main.js"]
