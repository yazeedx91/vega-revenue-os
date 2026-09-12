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
LABEL org.opencontainers.image.title="ProjectX Migration Bootstrap"

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @projectx/migration-bootstrap build
RUN pnpm --filter @projectx/migration-bootstrap deploy --prod /prod/migration
RUN mkdir -p /prod/migration/migrations
RUN cp /app/infra/database/migrations/*.sql /prod/migration/migrations/

FROM node:22-bookworm-slim AS runtime
ARG GIT_SHA
ARG CERTIFIED_RELEASE
ARG GIT_REPO

LABEL org.opencontainers.image.source="${GIT_REPO}"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${CERTIFIED_RELEASE}"
LABEL org.opencontainers.image.title="ProjectX Migration Bootstrap"

WORKDIR /prod/migration
COPY --from=builder --chown=node:node /prod/migration .
USER node
ENV MIGRATIONS_DIR=/prod/migration/migrations
CMD ["node", "dist/main.js"]
