# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Emanator is a self-hosted harness that runs one always-on personal Agent for one Owner. The Agent talks over Telegram and acts on schedules (Routines). It is built on the Claude Agent SDK.

Read these before changing behaviour:
- `CONTEXT.md` is the glossary. Code, docs and module names use its terms (Owner, Agent, Persona, Routine, Trigger, Run, Conversation, Faculty, Capability, …). Avoid the synonyms it lists.
- `docs/v1-scope.md` says what v1 includes. Deferred work goes in its **Later waves** list. Record new deferrals there instead of building them.
- `docs/adr/` holds the architectural decisions.

## Commands

Node ≥ 24, pnpm 12. Run commands from the repo root.

```sh
pnpm check              # Biome lint + format check (CI-style)
pnpm format             # Biome autofix
pnpm typecheck          # tsc for server/modules, then the web app
pnpm test               # vitest, all tests
pnpm build              # builds the dashboard (src/apps/web/dist)
pnpm dev                # Harness natively (needs .env and a reachable PostgreSQL)
pnpm dev:web            # Vite dashboard on :5173, proxying /api to :3000
docker compose up -d --build harness        # Harness + PostgreSQL 18
docker compose run --rm engine-smoke        # live Engine check against the real account
```

**Database tests.** Tests that touch PostgreSQL are skipped unless `TEST_DATABASE_URL` is set. Each test creates its own schema and drops it afterwards, so pointing at the Compose database is safe:

```sh
TEST_DATABASE_URL=postgresql://emanator:emanator@127.0.0.1:5432/emanator pnpm test
TEST_DATABASE_URL=… pnpm vitest run src/modules/routines/src/server/routine-service.test.ts -t "quota"
```

**Typechecking.** The root `tsconfig.json` excludes `src/modules/*/src/web/**`. Web files are typechecked through `src/apps/web` (`pnpm typecheck` covers both).

## Architecture

**A modular monolith with vertical feature slices (ADR 0005).**
- `src/apps/server/src/main.ts` is the composition root: one Fastify process runs the dashboard API, the Routine scheduler and the Telegram long-polling bot, and serves the built SPA.
- `src/apps/web` is the React/Vite shell. It only composes the pages that the modules export.
- Each `src/modules/<feature>` is a workspace package named after a glossary term (`engine`, `channels`, `conversations`, `personas`, `routines`, `shared`), with up to three entry points:
  - `@emanator/<feature>`: domain types, pure;
  - `@emanator/<feature>/server`: stores, services, Fastify routes;
  - `@emanator/<feature>/web`: React pages.

  Web code imports only types from the domain, so no server code reaches the browser bundle.
- Features use each other only through these public entry points. `shared` holds infrastructure only: the PostgreSQL pool, transactions, migrations, the logger and `createTestDatabase`.

**Persistence (ADR 0007).** PostgreSQL is the only application database. Each feature owns its tables and runs its own migrations through `runMigrations(db, '<feature>', migrations)`. Migrations are an append-only array of `{ id, sql }`; never edit an id that has shipped. Engine transcripts live under `./data/claude`, and PostgreSQL stores only an opaque `SessionRef` (ADR 0006).

**Ports and adapters inside their feature.**
- **Engine** (`modules/engine`): `Engine.runTurn()` yields `EngineEvent`s (`turn.started`, `tool.called`, `usage.limit`, `turn.completed`/`turn.failed`, …). Every turn is a separate SDK call that resumes a session. The only adapter is the Claude Agent SDK (`adapters/claude-agent-sdk`). It is isolated from the host's Claude Code setup, and the model sees no tools unless they are given. `FakeEngine` (`@emanator/engine/testing`) plays scripted turns in tests.
- **Channel** (`modules/channels`): moves messages in threads. `threadId === undefined` means the General thread. The Telegram adapter uses grammY with topics in the private chat. A deleted thread surfaces as `ThreadNotFoundError`. `FakeChannel` (`@emanator/channels/testing`) is the test double.

**Conversations** (`modules/conversations`). Each Telegram topic maps to a Conversation with its own Engine session.
- `ConversationService` queues events per thread (`KeyedQueue`): turns run in order within a thread and in parallel across threads.
- A Conversation name identifies a *live* Conversation: a partial unique index, so archiving frees the name. `general` is reserved for the General thread, and the `-routine` suffix is reserved for Routine topics.
- Messages a Routine delivers are stored as *handoffs*. They are prepended to the Owner's next turn in that Conversation and cleared once the Engine starts that turn.

**Routines** (`modules/routines`). A Routine is a prompt plus Triggers: `once` with an ISO offset, `interval` anchored to `updatedAt`, or 5-field `cron` read in `EMANATOR_TIMEZONE` via `croner`.
- `RoutineService` is what the API calls. Every create, update or delete reschedules `RoutineScheduler` at once, so there is no restart (hot reload). Events missed while the Harness was down are skipped.
- `RoutineRunner` runs each Run in a fresh Engine session. It delivers the reply under a `**⏰ name**` header to the Routine's own `<slug>-routine` topic, which is opened lazily, shared by parallel Runs, renamed with the Routine and archived on delete.
- A reply of exactly `[silent]` sends nothing.
- On `usage-limit` the Run waits for the reset with status `waiting` and the Owner gets a single notice. `stop()` aborts those waits.
- Run outcomes are stored in `routine_runs`.

**Dashboard.**
- It is served on `127.0.0.1:3000` without authentication. `dashboard-server.ts` rejects non-loopback hosts and cross-origin writes. For that reason the Vite proxy keeps the Host header (`changeOrigin: false`).
- Pages receive `language` (`it`/`en`) and report unsaved edits through `onDirtyChange`, so `App.tsx` can ask before navigating away.

## Conventions

- Code, comments and docs are in English. User-facing text (the dashboard, and the Telegram messages in `messages.ts` files) is in Italian, with English for the dashboard too.
- Biome style: 2 spaces, single quotes, 100 columns. TypeScript is strict with `noUncheckedIndexedAccess`, and imports use explicit `.ts` extensions.
- Comments are short and explain *why*. Match the density of the surrounding code.
- The Agent has no Tools yet: Engine calls pass a deny-all `PermissionDecider` until the Policies module exists.
