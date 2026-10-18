# Harness image. Dependencies are installed inside the image so the Agent SDK
# picks up the Claude Code binary for Linux, not the host's.
FROM node:24-bookworm-slim

RUN npm install --global pnpm@12.9.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/apps/server/package.json src/apps/server/
COPY src/apps/web/package.json src/apps/web/
COPY src/modules/channels/package.json src/modules/channels/
COPY src/modules/conversations/package.json src/modules/conversations/
COPY src/modules/engine/package.json src/modules/engine/
COPY src/modules/shared/package.json src/modules/shared/
COPY src/modules/personas/package.json src/modules/personas/
# Install as the runtime user so pnpm's store and workspace modules have matching ownership.
RUN mkdir -p /data && chown -R node:node /app /data
USER node
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
RUN pnpm --filter @emanator/web build

# Sessions, state and reports live on a volume mounted here.
ENV EMANATOR_DATA_DIR=/data
EXPOSE 3000
