# Emanator — v1 scope

Emanator is an open-source (MIT), self-hosted harness. It runs one always-on personal Agent for one Owner. The Agent acts in response to Events and talks with the Owner over Telegram.

Vocabulary is defined in [CONTEXT.md](../CONTEXT.md). Architectural decisions are in [docs/adr/](adr/).

## In v1

### Agent and Persona
- There is one Agent.
- Its Persona starts from a built-in preset inspired by well-known AI assistants (Jarvis, Cortana, Joi, …) or is written from scratch. Either way the Owner can customise the name and style.

### Routines
- A Routine is a prompt plus one or more scheduled Triggers: a specific date, an interval or a cron expression.
- The Agent decides which Faculties, Capabilities and Skills to use.
- Each Routine picks its own model and the Conversation it delivers to.
- A Run may finish without messaging the Owner. A Heartbeat is just a Routine.
- Runs, including Runs of the same Routine, execute in parallel.
- Events that fire while the Harness is down are skipped.

### Conversations (Telegram)
- Each Conversation is a Telegram topic in the private chat with the bot: a "General" topic plus dedicated ones. Both the Owner and the Agent can open a topic.
- A Routine's output lands in its target Conversation, so replies there have that context.
- Context is reset only by the Owner with `/new`, and is compacted automatically when it grows too large.
- Messages within one Conversation are queued and handled in order.
- Bot commands are in English (`/start`, `/new`, …). The bot answers only the paired Owner chat, using a pairing code shown in the UI.
- Telegram is used in long-polling mode, so no public URL is needed.

### Agent abilities
- **Faculties:** web search and fetch, files confined to the working folder, and opening Conversations. There is no shell in v1.
- **Capabilities:** remote MCP servers only.
  - There is one Capability per account, each assigned to an Area (Personal, Work, Volunteering, …).
  - The Harness acts as an MCP OAuth client. It supports both dynamic client registration and pre-registered client ID/secret.
- **Skills:** instruction-only SKILL.md packages, created, edited or uploaded from the UI.

### Control
- Each Tool has a Policy: *allow*, *ask* or *deny*.
  - Defaults come from MCP tool annotations: read-only starts as *allow*, write or destructive as *ask*.
  - The Owner can change Policies in the UI.
- Approvals arrive on Telegram as Yes/No buttons. Each is repeated once, and when it expires it counts as a denial.

### Google (Gmail and Calendar)
- Start with Google's official remote MCP servers, read-only.
- **Plan B:** if the Owner's account isn't admitted to the preview, run `workspace-mcp` as a local MCP server inside the Sandbox. The Sandbox then enters v1, still without the shell.

### Engine and quota
- The Claude Agent SDK runs with the Owner's subscription token (`claude setup-token`) or an API key, supplied via `.env`.
- There is a default model, and Routines and Conversations can override it.
- When the usage limit is hit, Runs wait for the reset and the Owner gets one notice.

### UI
- Served on localhost only, with no authentication in v1.
- Covers:
  - Persona;
  - Areas;
  - Capabilities, including the OAuth "Connect" button;
  - Skills;
  - Faculties and Policies;
  - Routines, with "run now" and Run history including transcripts and Tools used;
  - Conversations;
  - Telegram pairing.
- Translated into Italian and English.

### Failures
A failed Run sends a notice to its target Conversation and is detailed in the Run history.

## Architecture

- **Modular monolith** in a pnpm TypeScript monorepo, organised as vertical feature slices named after glossary terms. Each slice holds domain, server API and UI ([ADR 0005](adr/0005-vertical-feature-slices.md)).
- **Process:** a single Node process (Fastify or Hono) runs the API, scheduler and Telegram bot, and serves a Vite + React SPA.
- **Engine:** a swappable port; the first adapter is the Claude Agent SDK ([ADR 0001](adr/0001-swappable-engine-agent-sdk-with-owner-subscription.md)).
- **Portable abilities:** Faculties, Capabilities (MCP) and Skills. Plugins are only packaging ([ADR 0002](adr/0002-portable-agent-abilities-plugins-are-packaging.md)).
- **Storage:** definitions live in files (Markdown with frontmatter, YAML) that can be versioned with git; runtime state lives in SQLite ([ADR 0003](adr/0003-definitions-in-files-state-in-sqlite.md)).
- **Containers:** the Harness container holds the secrets. A single Sandbox container runs local and third-party code, with one unprivileged Linux user per process ([ADR 0004](adr/0004-separate-harness-and-sandbox.md)).
- **Hosting:** Docker, starting on a local machine; a VPS or home server later.
- **Language:** code and docs in English; UI in Italian and English.

## Later waves

- Webhook Triggers, through a tunnel that exposes only `/webhook`, and filtering of external events.
- Reminders and self-scheduling: the Agent creates one-off Reminders freely, and recurring Routines with the Owner's confirmation. This enables calendar-aware preparation reminders through a "planner" Routine.
- Memory: Markdown notes curated by the Agent.
- Sandbox with the shell Faculty (on *ask*), local MCP servers and Skills with scripts.
- Plugin installation from Claude Code marketplaces.
- Injecting new messages into the turn already in progress, instead of queueing them.
- Catching up on Events missed while the Harness was down.
- Handling overlapping Runs of the same Routine. In v1 they run in parallel, which is a known issue.
- Restricting Capabilities per Routine.
- Usage metrics panel: quota per window (five-hour, seven-day), turns, and estimated cost per Routine and Conversation, built on the Engine's `usage.limit` events.
- UI authentication and deployment to a VPS. On Linux hosts the `./data` bind mount must be writable by the container's `node` user (uid 1000). Docker creates a missing `./data` as root, so the Harness would crash-loop; Docker Desktop on macOS hides this.
- Multiple Agents, and project workflows with dedicated development containers.
- The ideas carried over from the first prototype, in [legacy-ideas.md](legacy-ideas.md):
  - briefing behaviours, Action requests and commitments;
  - a Decider for typed micro-decisions;
  - Memory with confirmed facts and an initial interview;
  - 👍/👎 feedback and `/perché`;
  - budget alerts, quiet hours and urgency rules;
  - Approval execution patterns;
  - the panel's design tokens;
  - the Persona prompts and their fixed rules.

## Risks to check first

- **Subscription token with the Agent SDK:** it works end to end (smoke run on 2026-10-14, see ADR 0001), but it remains a grey area in Anthropic's terms.
- **Telegram topics opened by the bot:** still to confirm that the Owner can write inside them while users are not allowed to create topics.
- **Google official MCP servers:** they are in Developer Preview, and it is unverified whether a personal @gmail.com account is accepted. An unverified Google OAuth app with Gmail scopes must be set to "In production" to avoid 7-day token expiry.
- **Built-in Personas named after real characters** (Jarvis, Cortana, Joi): trademark and copyright risk once the project is public.
