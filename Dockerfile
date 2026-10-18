# Harness image. Dependencies are installed inside the image so the Agent SDK
# picks up the Claude Code binary for Linux, not the host's.
FROM node:24-bookworm-slim

RUN npm install --global pnpm@12.9.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/channels/package.json packages/channels/
COPY packages/conversations/package.json packages/conversations/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY packages/personas/package.json packages/personas/
# Install as the runtime user so pnpm's store and workspace modules have matching ownership.
RUN mkdir -p /data && chown -R node:node /app /data
USER node
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
RUN pnpm --filter @emanator/web build

# Sessions, state and reports live on a volume mounted here.
ENV EMANATOR_DATA_DIR=/data
EXPOSE 3000
