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
- Each `src/modules/<feature>` is a workspace package named after a glossary term (`engine`, `channels`, `conversations`, `personas`, `routines`, `policies`, `faculties`, `capabilities`, `shared`), with up to three entry points:
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

**Policies and Faculties** (`modules/policies`, `modules/faculties`).
- Every Tool has a Policy: the Owner's choice in `tool_policies`, else its default. Tools nobody declared are denied, and denied Tools are not given to the model: each turn gets its `abilities` (Harness Tools and Engine Tools) filtered by `PolicyService.usable`.
- `PolicyService.decider()` builds each turn's `PermissionDecider`. *ask* sends an Approval with Yes/No buttons to the turn's thread; it is repeated after 15 minutes and expires 15 minutes later. Callers outside Policies, like Memory, may word the request themselves (`ApprovalRequest.message`). Any error while deciding denies the Tool.
- Button presses (`InboundAction`) go straight to `ApprovalService.answer()`, never through a Conversation's queue: the turn waiting for the answer may hold it.
- Each Faculty is one file in `faculties/src/server` that describes its Tools once: name, dashboard title, default Policy, allowed `choices` and, for a Harness Tool, its implementation. Policies, turns and the dashboard all read from there, so the dashboard has no per-Tool code.
- Policy groups carry a `kind` (`faculty` or `capability`): each dashboard page shows and saves only its own, and a save changes only the Tools it names.
- Web and files are Engine Tools (`ENGINE_TOOLS`, `TurnRequest.engineTools`); the adapter refuses any file path outside the working folder before Policies are asked. The SDK reads inside the folder without asking, so reading Tools declare `choices` without *ask*. `open_conversation` is a Harness Tool.

**Memory** (`modules/memory`, ADR 0009). An Obsidian-compatible wiki of Pages in `./data/memory`, in Italian: one Page per subject, filed under its kind's folder (`persone/Marco Rossi.md`), with `Utente.md`, `index.md`, `log.md` and the kinds in `tipi.md`. It sits outside the working folder, so only `MemoryService` writes it: one write at a time, each a git commit.
- Each Fact is *confirmed* or *inferred*. A `TurnTrust` per turn decides which: the turns the Owner starts confirm until outside content reaches them. Then they are tainted: a handoff taints from the start, and `TurnRequest.onToolUse` taints on any Tool but Memory's and `open_conversation`. `recall` taints when it reads inferred Facts.
- In a tainted turn, a preference, an instruction, or a change to a confirmed Fact needs the Owner's Approval; a new kind falls back to `altro`. Runs get only `recall`.
- `prepareTurn(context)` builds each turn's Tools and decider, Memory's included. `memoryPrompt` puts confirmed preferences and instructions in the system prompt as instructions, and the Owner's Page and the index as data, within fixed budgets.

**Capabilities** (`modules/capabilities`, ADR 0008). Each is a remote MCP server for one account. The Harness is its only MCP and OAuth client; the Engine never sees a token.
- `CapabilityConnections` connects, authorizes through the Owner's browser (`/api/capabilities/oauth/callback`), refreshes tokens and calls Tools. Secrets are sealed by `SecretBox` (`EMANATOR_SECRET_KEY`) before they reach PostgreSQL.
- Listed Tools are cached in `capability_tools`. `CapabilityService` keeps the Capabilities and their Tools in memory, because `PolicyService.groups()` is synchronous. Its `turnTools()` gives turns the Tools of enabled Capabilities as `JsonSchemaToolDefinition`s named `<slug>__<tool>`, which is why the slug never changes.
- Every call failure becomes an error result, never a failed turn. A grant that can't be refreshed sets `needs-auth` and tells the Owner once, in General.
- `fake-mcp-server.ts` is a real MCP server with a minimal OAuth server (discovery, dynamic registration, PKCE, refresh), for tests.
- `CATALOG` (domain) lists the Capabilities the Harness sets up itself; `CapabilityCatalog` resolves each entry from `.env` (client, address), and `CapabilityService.init()` brings catalog Capabilities in line with it at every start. Catalog Capabilities can't be edited, only connected, switched or deleted.
- Gmail and Calendar are two catalog entries on one workspace-mcp (a Compose service started with the Harness, pinned and stateless). Each has its own scopes and grant; its `toolPattern` keeps only its product's Tools, filtered in `CapabilityService.toolsFor`. A Capability whose entry leaves the catalog is deleted at start.

**Dashboard.**
- It is served on `127.0.0.1:3000` without authentication. `dashboard-server.ts` rejects non-loopback hosts and cross-origin writes. For that reason the Vite proxy keeps the Host header (`changeOrigin: false`).
- It is in English only. Pages report unsaved edits through `onDirtyChange`, so `App.tsx` can ask before navigating away, and ask the Owner yes/no questions through the `confirm` prop, which opens the shell's `ConfirmDialog` (never `window.confirm`).
- `src/apps/web/src/styles.css` is the design system: tokens (4px spacing scale, type scale, colours with a dark variant) and the primitives every page shares (`.page`, `.section`, `.panel`, `.btn`, `.field`, `.save-bar`, …). A module's CSS module holds only its page layout and reads the tokens; it never hardcodes colours or sizes. Icons come from `@phosphor-icons/react`; services' own logos are their makers' SVGs, kept in the module's `web/logos`. Fonts are Geist via `@fontsource`.

## Conventions

- Code, comments and docs are in English. The dashboard is in English; the Telegram messages in `messages.ts` files are in Italian.
- Biome style: 2 spaces, single quotes, 100 columns. TypeScript is strict with `noUncheckedIndexedAccess`, and imports use explicit `.ts` extensions.
- Comments are short and explain *why*. Match the density of the surrounding code.
- A new Tool is declared in its Faculty with its default Policy, or Policies deny it. A new Engine Tool also goes in `ENGINE_TOOLS`, with its SDK name in the adapter's `tool-names.ts`.
