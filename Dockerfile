# Harness image. Dependencies are installed inside the image so the Agent SDK
# picks up the Claude Code binary for Linux, not the host's.
FROM node:22-bookworm-slim

RUN npm install --global pnpm@12.9.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
RUN pnpm install --frozen-lockfile

COPY . .

# Sessions, state and reports live on a volume mounted here.
RUN mkdir -p /data && chown node:node /data
ENV EMANATOR_DATA_DIR=/data

USER node
