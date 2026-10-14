# Harness image. Dependencies are installed inside the image so the Agent SDK
# picks up the Claude Code binary for Linux, not the host's.
FROM node:24-bookworm-slim

RUN npm install --global pnpm@12.9.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/channels/package.json packages/channels/
COPY packages/conversations/package.json packages/conversations/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

# Sessions, state and reports live on a volume mounted here.
RUN mkdir -p /data && chown node:node /data
ENV EMANATOR_DATA_DIR=/data

USER node
