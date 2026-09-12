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
LABEL org.opencontainers.image.title="ProjectX API"

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build

RUN pnpm --filter @projectx/api deploy /prod/api

FROM node:22-bookworm-slim AS runtime
ARG GIT_SHA
ARG CERTIFIED_RELEASE
ARG GIT_REPO

LABEL org.opencontainers.image.source="${GIT_REPO}"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${CERTIFIED_RELEASE}"
LABEL org.opencontainers.image.title="ProjectX API"

WORKDIR /prod/api
COPY --from=builder --chown=node:node /prod/api .

USER node
EXPOSE 3000

CMD ["node", "dist/main"]
